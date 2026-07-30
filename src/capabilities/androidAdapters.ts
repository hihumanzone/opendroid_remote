import type { Adb } from "@yume-chan/adb";

import type { Diagnostics } from "../debug/Diagnostics";

export interface AndroidCapabilityAdapter {
  id: string;
  command: readonly string[];
  parse(output: string): number | undefined;
}

export interface UhidMouseCapability {
  supported: boolean;
  reason: string;
}

const UHID_PROBE_COMMAND = [
  "sh",
  "-c",
  "'if exec 9<>/dev/uhid 2>/dev/null; then exec 9>&-; printf uhid-ok; else printf uhid-unavailable; fi'",
] as const;

export function parseUhidProbe(output: string): UhidMouseCapability {
  return output.includes("uhid-ok")
    ? {
        supported: true,
        reason: "Android allowed the ADB shell identity to open /dev/uhid.",
      }
    : {
        supported: false,
        reason:
          "Android did not expose a writable UHID device to the ADB shell identity.",
      };
}

/**
 * scrcpy's server runs under the same ADB shell identity. Opening and
 * immediately closing `/dev/uhid` without registering a descriptor is a
 * side-effect-free capability probe and prevents a failed UHID_CREATE from
 * terminating the live scrcpy control thread on unsupported devices.
 */
export async function probeUhidMouse(
  adb: Adb,
  diagnostics?: Diagnostics,
): Promise<UhidMouseCapability> {
  try {
    const result = parseUhidProbe(
      await adb.subprocess.noneProtocol.spawnWaitText(UHID_PROBE_COMMAND),
    );
    diagnostics?.info(
      "control",
      "uhid-mouse-capability",
      result.supported
        ? "Android supports physical UHID mouse injection."
        : "Android UHID mouse injection is unavailable; direct mouse input will remain disabled unless SDK compatibility mode is selected.",
      result,
    );
    return result;
  } catch (error) {
    const result: UhidMouseCapability = {
      supported: false,
      reason: "The Android shell could not complete the UHID capability probe.",
    };
    diagnostics?.debug(
      "control",
      "uhid-mouse-probe-unavailable",
      `${result.reason} Direct mouse input will remain disabled unless SDK compatibility mode is selected.`,
      error,
    );
    return result;
  }
}

const FOCUSED_DISPLAY_PATTERNS = [
  /\bmTopFocusedDisplayId\s*=\s*(\d+)/,
  /\bmFocusedDisplayId\s*=\s*(\d+)/,
  /\btopFocusedDisplayId\s*=\s*(\d+)/,
  /\bfocusedDisplayId\s*=\s*(\d+)/,
  /\bmCurrentFocus\b[^\n]*\bdisplayId\s*=\s*(\d+)/,
] as const;

export function parseFocusedDisplayId(output: string): number | undefined {
  for (const pattern of FOCUSED_DISPLAY_PATTERNS) {
    const match = pattern.exec(output);
    if (match) return Number.parseInt(match[1]!, 10);
  }
  return undefined;
}

export const focusedDisplayAdapters: readonly AndroidCapabilityAdapter[] = [
  {
    id: "window-displays",
    command: ["dumpsys", "window", "displays"],
    parse: parseFocusedDisplayId,
  },
  {
    id: "window",
    command: ["dumpsys", "window"],
    parse: parseFocusedDisplayId,
  },
  {
    id: "activity-activities",
    command: ["dumpsys", "activity", "activities"],
    parse(output) {
      const focused = parseFocusedDisplayId(output);
      if (focused !== undefined) return focused;
      const resumed = /\bmResumedActivity\b[^\n]*\bdisplayId\s*=\s*(\d+)/.exec(
        output,
      );
      return resumed ? Number.parseInt(resumed[1]!, 10) : undefined;
    },
  },
];

export async function discoverFocusedDisplayId(
  adb: Adb,
  diagnostics?: Diagnostics,
): Promise<number | undefined> {
  for (const adapter of focusedDisplayAdapters) {
    try {
      const output = await adb.subprocess.noneProtocol.spawnWaitText(
        adapter.command,
      );
      const result = adapter.parse(output);
      diagnostics?.debug(
        "display",
        "focused-display-adapter",
        `${adapter.id} ${result === undefined ? "did not expose" : "reported"} a focused display.`,
        { adapter: adapter.id, focusedDisplayId: result },
      );
      if (result !== undefined) return result;
    } catch (error) {
      diagnostics?.debug(
        "display",
        "focused-display-adapter-unavailable",
        `${adapter.id} is not available on this Android build.`,
        error,
      );
    }
  }
  return undefined;
}

export function parseResolution(
  resolution: string | undefined,
): { width: number; height: number } | undefined {
  if (!resolution) return undefined;
  const match = /^\s*(\d+)\s*x\s*(\d+)\s*$/.exec(resolution);
  if (!match) return undefined;
  const width = Number.parseInt(match[1]!, 10);
  const height = Number.parseInt(match[2]!, 10);
  if (width <= 0 || height <= 0) return undefined;
  return { width, height };
}
