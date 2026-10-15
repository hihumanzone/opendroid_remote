import { describe, expect, it, vi } from "vitest";

import {
  AutoProfileCoordinator,
  DEFAULT_AUTO_PROFILE_PREFERENCES,
} from "../src/profiles/AutoProfileCoordinator";
import { createProfile, type GameProfile } from "../src/profiles/schema";

describe("AutoProfileCoordinator", () => {
  const pDefault: GameProfile = {
    ...createProfile("Default controls"),
    id: "profile-default",
  };

  const pGameA: GameProfile = {
    ...createProfile("Game A Profile"),
    id: "profile-game-a",
    game: { title: "Game A", packageName: "com.example.gamea" },
  };

  const pGameB: GameProfile = {
    ...createProfile("Game B Profile"),
    id: "profile-game-b",
    game: { title: "Game B", packageName: "com.example.gameb" },
  };

  const profiles = [pDefault, pGameA, pGameB];

  it("initializes with default preferences and idle status", () => {
    const coordinator = new AutoProfileCoordinator();
    expect(coordinator.state.status).toBe("idle");
    expect(coordinator.state.enabled).toBe(true);
    expect(coordinator.preferences).toEqual(DEFAULT_AUTO_PROFILE_PREFERENCES);
  });

  it("subscribes and notifies listener of state changes", () => {
    const coordinator = new AutoProfileCoordinator();
    const listener = vi.fn();
    const unsubscribe = coordinator.subscribe(listener);

    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ status: "idle" }),
    );

    coordinator.setControlMode("edit");
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ status: "paused-edit" }),
    );

    unsubscribe();
    coordinator.setControlMode("play");
    // Should not receive updates after unsubscribing
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("pauses auto-switching when entering edit mode", () => {
    const coordinator = new AutoProfileCoordinator();
    coordinator.setStreaming(true);
    coordinator.setControlMode("edit");

    expect(coordinator.state.status).toBe("paused-edit");
  });

  it("manages manual override and retains it until app changes", async () => {
    const switchHandler = vi.fn();
    const coordinator = new AutoProfileCoordinator({
      onSwitchProfile: switchHandler,
      preferences: { defaultProfileId: "profile-default" },
    });
    coordinator.setProfiles(profiles, "profile-game-a");

    // Manually select Game B profile
    coordinator.setManualOverride("profile-game-b");
    expect(coordinator.state.status).toBe("manual-override");
    expect(coordinator.state.manualOverrideProfileId).toBe("profile-game-b");

    // Clear override explicitly
    coordinator.clearManualOverride();
    expect(coordinator.state.manualOverrideProfileId).toBeUndefined();
  });

  it("updates preferences and toggles enabled state", () => {
    const coordinator = new AutoProfileCoordinator();
    coordinator.setPreferences({ autoSwitch: false, pollIntervalMs: 3000 });

    expect(coordinator.state.enabled).toBe(false);
    expect(coordinator.preferences.pollIntervalMs).toBe(3000);
    expect(coordinator.state.status).toBe("idle");
  });

  it("handles detected app transitions and auto-switches to matching profile", async () => {
    const switchHandler = vi.fn();
    const coordinator = new AutoProfileCoordinator({
      onSwitchProfile: switchHandler,
      preferences: { defaultProfileId: "profile-default" },
    });
    coordinator.setProfiles(profiles, "profile-default");

    // Simulate mock ADB device
    const mockAdb = {
      subprocess: {
        noneProtocol: {
          spawnWaitText: vi.fn().mockResolvedValue(
            "mCurrentFocus=Window{123 u0 com.example.gamea/.MainActivity}",
          ),
        },
      },
    } as unknown as import("@yume-chan/adb").Adb;

    coordinator.setAdb(mockAdb);
    coordinator.setStreaming(true);

    const probed = await coordinator.probeNow();
    expect(probed?.packageName).toBe("com.example.gamea");
    expect(coordinator.state.status).toBe("matched");
    expect(coordinator.state.matchedProfileId).toBe("profile-game-a");
    expect(switchHandler).toHaveBeenCalledWith(pGameA, expect.stringContaining("com.example.gamea"));
  });

  it("restores default profile when launcher is detected", async () => {
    const switchHandler = vi.fn();
    const coordinator = new AutoProfileCoordinator({
      onSwitchProfile: switchHandler,
      preferences: { defaultProfileId: "profile-default", fallbackToDefault: true },
    });
    coordinator.setProfiles(profiles, "profile-game-a");

    const mockAdb = {
      subprocess: {
        noneProtocol: {
          spawnWaitText: vi.fn().mockResolvedValue(
            "mCurrentFocus=Window{123 u0 com.google.android.apps.nexuslauncher/.NexusLauncherActivity}",
          ),
        },
      },
    } as unknown as import("@yume-chan/adb").Adb;

    coordinator.setAdb(mockAdb);
    coordinator.setStreaming(true);

    const probed = await coordinator.probeNow();
    expect(probed?.packageName).toBe("com.google.android.apps.nexuslauncher");
    expect(probed?.isLauncher).toBe(true);
    expect(coordinator.state.status).toBe("default-restored");
    expect(coordinator.state.matchedProfileId).toBe("profile-default");
    expect(switchHandler).toHaveBeenCalledWith(pDefault, expect.stringContaining("Home screen"));
  });

  it("clears manual override when user navigates to a different app", async () => {
    const switchHandler = vi.fn();
    const coordinator = new AutoProfileCoordinator({
      onSwitchProfile: switchHandler,
      preferences: { defaultProfileId: "profile-default" },
    });
    coordinator.setProfiles(profiles, "profile-game-a");

    let currentApp = "mCurrentFocus=Window{123 u0 com.example.gamea/.MainActivity}";
    const mockAdb = {
      subprocess: {
        noneProtocol: {
          spawnWaitText: vi.fn().mockImplementation(() => Promise.resolve(currentApp)),
        },
      },
    } as unknown as import("@yume-chan/adb").Adb;

    coordinator.setAdb(mockAdb);
    coordinator.setStreaming(true);

    // Initial probe on Game A
    await coordinator.probeNow();
    expect(coordinator.state.matchedProfileId).toBe("profile-game-a");

    // User manually overrides to Default profile while in Game A
    coordinator.setManualOverride("profile-default");
    expect(coordinator.state.status).toBe("manual-override");
    expect(coordinator.state.manualOverrideProfileId).toBe("profile-default");

    // Next probe on the same app: override remains intact
    await coordinator.probeNow();
    expect(coordinator.state.status).toBe("manual-override");

    // Now phone opens Game B
    currentApp = "mCurrentFocus=Window{456 u0 com.example.gameb/.MainActivity}";
    await coordinator.probeNow();

    // Override should have cleared automatically, switching to Game B!
    expect(coordinator.state.manualOverrideProfileId).toBeUndefined();
    expect(coordinator.state.status).toBe("matched");
    expect(coordinator.state.matchedProfileId).toBe("profile-game-b");
    expect(switchHandler).toHaveBeenCalledWith(pGameB, expect.stringContaining("com.example.gameb"));
  });
});
