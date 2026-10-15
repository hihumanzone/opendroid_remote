import type { Adb } from "@yume-chan/adb";

import {
  detectDefaultLauncher,
  detectForegroundApp,
  type ForegroundAppInfo,
} from "../capabilities/appDetection";
import type { Diagnostics } from "../debug/Diagnostics";
import { findProfileForPackage } from "./ProfileMatcher";
import type { GameProfile } from "./schema";

export type AutoProfileStatus =
  | "idle"
  | "monitoring"
  | "matched"
  | "default-restored"
  | "manual-override"
  | "paused-edit"
  | "error";

export interface AutoProfilePreferences {
  autoSwitch: boolean;
  pollIntervalMs: number;
  fallbackToDefault: boolean;
  defaultProfileId?: string;
}

export interface AutoProfileState {
  enabled: boolean;
  activePackage?: string;
  activityName?: string;
  isLauncher: boolean;
  isSystemUi: boolean;
  status: AutoProfileStatus;
  matchedProfileId?: string;
  matchedProfileName?: string;
  manualOverrideProfileId?: string;
  error?: string;
}

export type AutoProfileListener = (state: AutoProfileState) => void;
export type ProfileSwitchHandler = (
  profile: GameProfile,
  reason: string,
) => Promise<void>;

export interface AutoProfileCoordinatorOptions {
  diagnostics?: Diagnostics;
  onSwitchProfile?: ProfileSwitchHandler;
  preferences?: Partial<AutoProfilePreferences>;
}

export const DEFAULT_AUTO_PROFILE_PREFERENCES: AutoProfilePreferences = {
  autoSwitch: true,
  pollIntervalMs: 1500,
  fallbackToDefault: true,
};

export class AutoProfileCoordinator {
  readonly #diagnostics?: Diagnostics;
  readonly #listeners = new Set<AutoProfileListener>();
  #onSwitchProfile?: ProfileSwitchHandler;

  #adb?: Adb;
  #knownLauncher?: string;
  #displayId?: number;
  #profiles: readonly GameProfile[] = [];
  #streaming = false;
  #controlMode: "play" | "edit" = "play";
  #probing = false;
  #timer?: ReturnType<typeof setTimeout>;

  #preferences: AutoProfilePreferences;
  #manualOverrideProfileId?: string;
  #manualOverrideAppPackage?: string;
  #lastDetectedPackage?: string;
  #currentActiveProfileId?: string;

  #state: AutoProfileState = {
    enabled: true,
    isLauncher: false,
    isSystemUi: false,
    status: "idle",
  };

  constructor(options: AutoProfileCoordinatorOptions = {}) {
    this.#diagnostics = options.diagnostics;
    this.#onSwitchProfile = options.onSwitchProfile;
    this.#preferences = {
      ...DEFAULT_AUTO_PROFILE_PREFERENCES,
      ...options.preferences,
    };
    this.#state.enabled = this.#preferences.autoSwitch;
  }

  get state(): AutoProfileState {
    return { ...this.#state };
  }

  get preferences(): AutoProfilePreferences {
    return { ...this.#preferences };
  }

  subscribe(listener: AutoProfileListener): () => void {
    this.#listeners.add(listener);
    listener(this.#state);
    return () => this.#listeners.delete(listener);
  }

  setOnSwitchProfile(handler: ProfileSwitchHandler | undefined): void {
    this.#onSwitchProfile = handler;
  }

  setProfiles(profiles: readonly GameProfile[], currentActiveId?: string): void {
    this.#profiles = [...profiles];
    if (currentActiveId !== undefined) {
      this.#currentActiveProfileId = currentActiveId;
    }
  }

  setPreferences(preferences: Partial<AutoProfilePreferences>): void {
    this.#preferences = { ...this.#preferences, ...preferences };
    this.#state.enabled = this.#preferences.autoSwitch;
    this.#emitState();
    if (!this.#preferences.autoSwitch) {
      this.#stopTimer();
      this.#updateStatus("idle");
    } else {
      this.#scheduleNextPoll(100);
    }
  }

  setAdb(adb: Adb | undefined, displayId?: number): void {
    this.#adb = adb;
    this.#displayId = displayId;
    this.#knownLauncher = undefined;

    if (adb) {
      void detectDefaultLauncher(adb, this.#diagnostics).then((launcher) => {
        if (launcher) this.#knownLauncher = launcher;
      });
      if (this.#streaming && this.#preferences.autoSwitch) {
        this.#scheduleNextPoll(200);
      }
    } else {
      this.#stopTimer();
      this.#updateStatus("idle");
    }
  }

  setStreaming(streaming: boolean): void {
    this.#streaming = streaming;
    if (streaming && this.#adb && this.#preferences.autoSwitch) {
      this.#scheduleNextPoll(300);
    } else if (!streaming) {
      this.#stopTimer();
      this.#updateStatus("idle");
    }
  }

  setControlMode(mode: "play" | "edit"): void {
    const prevMode = this.#controlMode;
    this.#controlMode = mode;

    if (mode === "edit") {
      this.#stopTimer();
      this.#updateStatus("paused-edit");
    } else if (prevMode === "edit" && mode === "play") {
      if (this.#streaming && this.#adb && this.#preferences.autoSwitch) {
        this.#scheduleNextPoll(150);
      }
    }
  }

  setManualOverride(profileId: string): void {
    this.#manualOverrideProfileId = profileId;
    this.#manualOverrideAppPackage = this.#lastDetectedPackage;
    this.#currentActiveProfileId = profileId;
    this.#state = {
      ...this.#state,
      status: "manual-override",
      manualOverrideProfileId: profileId,
    };
    this.#emitState();
  }

  clearManualOverride(): void {
    this.#manualOverrideProfileId = undefined;
    this.#manualOverrideAppPackage = undefined;
    this.#state = {
      ...this.#state,
      manualOverrideProfileId: undefined,
    };
    this.#emitState();
    void this.probeNow();
  }

  async probeNow(): Promise<ForegroundAppInfo | undefined> {
    if (!this.#adb) return undefined;
    return this.#runProbe();
  }

  stop(): void {
    this.#stopTimer();
    this.#updateStatus("idle");
  }

  #stopTimer(): void {
    if (this.#timer !== undefined) {
      clearTimeout(this.#timer);
      this.#timer = undefined;
    }
  }

  #scheduleNextPoll(delayMs = this.#preferences.pollIntervalMs): void {
    this.#stopTimer();
    if (!this.#preferences.autoSwitch || !this.#streaming || !this.#adb || this.#controlMode === "edit") {
      return;
    }
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      void this.#runProbe().finally(() => {
        if (this.#preferences.autoSwitch && this.#streaming && this.#adb && this.#controlMode === "play") {
          this.#scheduleNextPoll();
        }
      });
    }, Math.max(100, delayMs));
  }

  async #runProbe(): Promise<ForegroundAppInfo | undefined> {
    const adb = this.#adb;
    if (!adb || this.#probing) return undefined;

    this.#probing = true;
    try {
      const info = await detectForegroundApp(adb, {
        targetDisplayId: this.#displayId,
        knownLauncher: this.#knownLauncher,
        diagnostics: this.#diagnostics,
      });

      if (!info) {
        return undefined;
      }

      this.#handleDetectedApp(info);
      return info;
    } catch (error) {
      this.#diagnostics?.debug(
        "profile",
        "probe-failed",
        "Foreground app probe encountered an error.",
        error,
      );
      this.#state = {
        ...this.#state,
        status: "error",
        error: error instanceof Error ? error.message : String(error),
      };
      this.#emitState();
      return undefined;
    } finally {
      this.#probing = false;
    }
  }

  #handleDetectedApp(info: ForegroundAppInfo): void {
    const packageChanged = info.packageName !== this.#lastDetectedPackage;
    this.#lastDetectedPackage = info.packageName;

    // Check if manual override was set on a previous app. If user switched to a DIFFERENT
    // app, clear the manual override so auto-switching activates for the new app.
    if (
      this.#manualOverrideProfileId &&
      packageChanged &&
      info.packageName !== this.#manualOverrideAppPackage
    ) {
      this.#diagnostics?.info(
        "profile",
        "override-cleared",
        `Cleared manual profile override because app changed to ${info.packageName}.`,
      );
      this.#manualOverrideProfileId = undefined;
      this.#manualOverrideAppPackage = undefined;
    }

    this.#state = {
      ...this.#state,
      activePackage: info.packageName,
      activityName: info.activityName,
      isLauncher: info.isLauncher,
      isSystemUi: info.isSystemUi,
      manualOverrideProfileId: this.#manualOverrideProfileId,
      error: undefined,
    };

    // If manual override is still active, don't auto-switch profiles
    if (this.#manualOverrideProfileId) {
      this.#state.status = "manual-override";
      this.#state.manualOverrideProfileId = this.#manualOverrideProfileId;
      this.#emitState();
      return;
    }

    // Resolve matching profile for foreground app or launcher
    const match = findProfileForPackage(
      this.#profiles,
      info.packageName,
      {
        defaultProfileId: this.#preferences.defaultProfileId,
        fallbackToDefault: this.#preferences.fallbackToDefault,
        isLauncherOrHome: info.isLauncher,
      },
    );

    if (match) {
      const targetProfile = match.profile;
      const isDefault = match.matchType === "default-fallback";
      this.#state.status = isDefault ? "default-restored" : "matched";
      this.#state.matchedProfileId = targetProfile.id;
      this.#state.matchedProfileName = targetProfile.name;

      if (targetProfile.id !== this.#currentActiveProfileId) {
        this.#currentActiveProfileId = targetProfile.id;
        const reason = isDefault
          ? info.isLauncher
            ? "Home screen / launcher active"
            : `Default profile for unmapped app (${info.packageName})`
          : `Detected active app: ${info.packageName}`;

        this.#diagnostics?.info(
          "profile",
          "profile-switched",
          `Auto-switching to profile “${targetProfile.name}”: ${reason}`,
          { profileId: targetProfile.id, app: info },
        );

        if (this.#onSwitchProfile) {
          void this.#onSwitchProfile(targetProfile, reason);
        }
      }
    } else {
      this.#state.status = "monitoring";
      this.#state.matchedProfileId = undefined;
      this.#state.matchedProfileName = undefined;
    }

    this.#emitState();
  }

  #updateStatus(status: AutoProfileStatus): void {
    if (this.#state.status !== status) {
      this.#state = { ...this.#state, status };
      this.#emitState();
    }
  }

  #emitState(): void {
    const copy = this.state;
    for (const listener of this.#listeners) {
      listener(copy);
    }
  }
}
