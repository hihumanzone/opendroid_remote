import type { Adb } from "@yume-chan/adb";

import type { Diagnostics } from "../debug/Diagnostics";

export interface ForegroundAppInfo {
  packageName: string;
  activityName?: string;
  isLauncher: boolean;
  isSystemUi: boolean;
  timestamp: number;
}

export interface AppDetectionAdapter {
  id: string;
  command: readonly string[];
  parse(output: string, targetDisplayId?: number): { packageName: string; activityName?: string } | undefined;
}

const SYSTEM_UI_PACKAGE = "com.android.systemui";

const KNOWN_LAUNCHER_PATTERNS = [
  /^com\.(google\.android\.apps\.nexuslauncher|android\.launcher\d*|sec\.android\.app\.launcher|miui\.home|huawei\.android\.launcher|oppo\.launcher|coloros\.launcher|oneplus\.launcher|motorola\.launcher\d*|teslacoilsw\.launcher|microsoft\.launcher)$/i,
  /launcher/i,
  /home/i,
];

/**
 * Normalizes activity name if it uses relative notation (e.g., ".MainActivity").
 */
export function normalizeActivityName(packageName: string, activityPart?: string): string | undefined {
  if (!activityPart || activityPart === "null") return undefined;
  const trimmed = activityPart.trim();
  if (trimmed.startsWith(".")) {
    return `${packageName}${trimmed}`;
  }
  return trimmed;
}

/**
 * Parses package and activity from a component string like "com.example.app/.MainActivity"
 * or "com.example.app/com.example.app.MainActivity".
 */
export function parseComponentString(
  raw: string,
): { packageName: string; activityName?: string } | undefined {
  const match = /([a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)+)\/([^\s}]+)/.exec(raw);
  if (!match) return undefined;
  const packageName = match[1]!;
  const activityName = normalizeActivityName(packageName, match[2]);
  return { packageName, activityName };
}

/**
 * Extracts the foreground package and activity from window manager dumps.
 * Handles:
 *   mCurrentFocus=Window{... [u0 ]<component>}
 *   mFocusedApp=ActivityRecord{... [u0 ]<component> ...}
 *   focusedApp=ActivityRecord{... [u0 ]<component> ...}
 * When mCurrentFocus is SystemUI (e.g. volume slider / notification shade),
 * prioritizes mFocusedApp if available so the active game isn't falsely replaced.
 */
export function parseWindowDumpsys(
  output: string,
  targetDisplayId?: number,
): { packageName: string; activityName?: string } | undefined {
  if (!output || output.trim().length === 0) return undefined;

  // If a target display ID is provided, try to extract the section for that display first
  let searchScope = output;
  if (targetDisplayId !== undefined) {
    const displayRegex = new RegExp(
      `Display:\\s*(?:mDisplayId=)?${targetDisplayId}\\b[\\s\\S]*?(?:Display:\\s*(?:mDisplayId=)?\\d+\\b|$)`,
      "i",
    );
    const displayMatch = displayRegex.exec(output);
    if (displayMatch) {
      searchScope = displayMatch[0];
    }
  }

  let currentFocusComponent: { packageName: string; activityName?: string } | undefined;
  let focusedAppComponent: { packageName: string; activityName?: string } | undefined;

  // Check mCurrentFocus
  const focusMatch = /\bmCurrentFocus\b[^\n=]*=Window\{[^\n}]*\s(?:u\d+\s+)?([a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)+\/[^\s}]+)/.exec(
    searchScope,
  );
  if (focusMatch && focusMatch[1]) {
    currentFocusComponent = parseComponentString(focusMatch[1]);
  }

  // Check mFocusedApp or focusedApp
  const appMatch = /\b(?:mFocusedApp|focusedApp)\b[^\n=]*=ActivityRecord\{[^\n}]*\s(?:u\d+\s+)?([a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)+\/[^\s}]+)/.exec(
    searchScope,
  );
  if (appMatch && appMatch[1]) {
    focusedAppComponent = parseComponentString(appMatch[1]);
  }

  // If current focus is SystemUI (like a volume dialog, notification shade, or navigation bar),
  // but an app is focused underneath, favor the focused app.
  if (currentFocusComponent?.packageName === SYSTEM_UI_PACKAGE && focusedAppComponent) {
    return focusedAppComponent;
  }

  if (currentFocusComponent && currentFocusComponent.packageName !== "null") {
    return currentFocusComponent;
  }

  if (focusedAppComponent && focusedAppComponent.packageName !== "null") {
    return focusedAppComponent;
  }

  // Fallback pattern: Any window component match
  const generalMatch = /\bWindow\{[^\n}]*\s(?:u\d+\s+)?([a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)+\/[^\s}]+)/.exec(
    searchScope,
  );
  if (generalMatch && generalMatch[1]) {
    return parseComponentString(generalMatch[1]);
  }

  return undefined;
}

/**
 * Extracts resumed activity from activity manager dumpsys.
 * Handles:
 *   mResumedActivity: ActivityRecord{... [u0 ]<component> ...}
 *   topResumedActivity=ActivityRecord{... [u0 ]<component> ...}
 *   ResumedActivity: ActivityRecord{... [u0 ]<component> ...}
 *   ACTIVITY <component> ...
 */
export function parseActivityDumpsys(
  output: string,
): { packageName: string; activityName?: string } | undefined {
  if (!output || output.trim().length === 0) return undefined;

  const resumedMatch = /\b(?:mResumedActivity|topResumedActivity|ResumedActivity)\b[^\n]*ActivityRecord\{[^\n}]*\s(?:u\d+\s+)?([a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)+\/[^\s}]+)/.exec(
    output,
  );
  if (resumedMatch && resumedMatch[1]) {
    return parseComponentString(resumedMatch[1]);
  }

  const activityLineMatch = /\bACTIVITY\s+([a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)+\/[^\s}]+)/.exec(
    output,
  );
  if (activityLineMatch && activityLineMatch[1]) {
    return parseComponentString(activityLineMatch[1]);
  }

  return undefined;
}

/**
 * Multi-tiered adapters for foreground app detection.
 * Ordered by speed and reliability.
 */
export const foregroundAppAdapters: readonly AppDetectionAdapter[] = [
  {
    id: "window-grep",
    // Fastest single-command method: device shell pipes to grep, sending only matching lines over WebUSB
    command: ["sh", "-c", "dumpsys window | grep -E 'mCurrentFocus|mFocusedApp'"],
    parse: (output) => parseWindowDumpsys(output),
  },
  {
    id: "window-displays",
    // Standard dumpsys window displays (compact, display-aware)
    command: ["dumpsys", "window", "displays"],
    parse: (output, displayId) => parseWindowDumpsys(output, displayId),
  },
  {
    id: "activity-grep",
    // Activity manager resumed activity grep
    command: [
      "sh",
      "-c",
      "dumpsys activity activities | grep -E 'mResumedActivity|topResumedActivity|ResumedActivity'",
    ],
    parse: (output) => parseActivityDumpsys(output),
  },
  {
    id: "activity-top",
    // Activity manager top activity dump
    command: ["dumpsys", "activity", "top"],
    parse: (output) => parseActivityDumpsys(output),
  },
];

/**
 * Checks whether a package name corresponds to a launcher / home screen.
 */
export function isLauncherPackage(
  packageName: string,
  knownLauncher?: string,
): boolean {
  if (!packageName) return false;
  if (knownLauncher && packageName.toLowerCase() === knownLauncher.toLowerCase()) {
    return true;
  }
  return KNOWN_LAUNCHER_PATTERNS.some((pattern) => pattern.test(packageName));
}

/**
 * Detects the currently active foreground application on the device.
 */
export async function detectForegroundApp(
  adb: Adb,
  options: {
    targetDisplayId?: number;
    knownLauncher?: string;
    diagnostics?: Diagnostics;
  } = {},
): Promise<ForegroundAppInfo | undefined> {
  for (const adapter of foregroundAppAdapters) {
    try {
      const output = await adb.subprocess.noneProtocol.spawnWaitText(adapter.command);
      const parsed = adapter.parse(output, options.targetDisplayId);
      if (parsed && parsed.packageName && parsed.packageName !== "null") {
        const isSystemUi = parsed.packageName === SYSTEM_UI_PACKAGE;
        const isLauncher = isLauncherPackage(parsed.packageName, options.knownLauncher);
        return {
          packageName: parsed.packageName,
          activityName: parsed.activityName,
          isLauncher,
          isSystemUi,
          timestamp: Date.now(),
        };
      }
    } catch (error) {
      options.diagnostics?.debug(
        "adb",
        "adapter-failed",
        `App detection adapter ${adapter.id} encountered an error.`,
        error,
      );
    }
  }
  return undefined;
}

/**
 * Resolves the device's default Home launcher package name using cmd package.
 */
export async function detectDefaultLauncher(
  adb: Adb,
  diagnostics?: Diagnostics,
): Promise<string | undefined> {
  const commands: ReadonlyArray<readonly string[]> = [
    [
      "cmd",
      "package",
      "resolve-activity",
      "-c",
      "android.intent.category.HOME",
      "-a",
      "android.intent.action.MAIN",
    ],
    [
      "pm",
      "resolve-activity",
      "-c",
      "android.intent.category.HOME",
      "-a",
      "android.intent.action.MAIN",
    ],
  ];

  for (const command of commands) {
    try {
      const output = await adb.subprocess.noneProtocol.spawnWaitText(command);
      const parsed = parseComponentString(output);
      if (parsed?.packageName && parsed.packageName !== "android") {
        diagnostics?.debug(
          "adb",
          "default-launcher-detected",
          `Detected default launcher: ${parsed.packageName}`,
          parsed,
        );
        return parsed.packageName;
      }
    } catch {
      // Continue to next command candidate
    }
  }
  return undefined;
}

/**
 * Lists installed package names on the device.
 * Defaults to third-party (-3) packages to show games and user apps.
 */
export async function listInstalledPackages(
  adb: Adb,
  thirdPartyOnly = true,
  diagnostics?: Diagnostics,
): Promise<string[]> {
  const flags = thirdPartyOnly ? ["-3"] : [];
  const commands: ReadonlyArray<readonly string[]> = [
    ["cmd", "package", "list", "packages", ...flags],
    ["pm", "list", "packages", ...flags],
  ];

  for (const command of commands) {
    try {
      const output = await adb.subprocess.noneProtocol.spawnWaitText(command);
      const packages: string[] = [];
      const lines = output.split(/\r?\n/);
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith("package:")) {
          const pkg = trimmed.slice("package:".length).trim();
          if (pkg.length > 0) packages.push(pkg);
        }
      }
      if (packages.length > 0) {
        packages.sort((a, b) => a.localeCompare(b));
        return packages;
      }
    } catch (error) {
      diagnostics?.debug(
        "adb",
        "list-packages-failed",
        `Failed listing packages via ${command.join(" ")}`,
        error,
      );
    }
  }
  return [];
}
