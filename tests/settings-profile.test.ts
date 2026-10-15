import { describe, expect, it } from "vitest";

import { ProfileRepository } from "../src/profiles/ProfileRepository";
import { createProfile } from "../src/profiles/schema";
import {
  AppSettingsRepository,
  createDefaultAppSettings,
  DEFAULT_PROFILE_PREFERENCES,
  parseAppSettings,
  type AppSettings,
} from "../src/settings/AppSettings";

describe("Settings & ProfileRepository Enhancements", () => {
  describe("AppSettings profilePreferences", () => {
    it("creates default settings with profilePreferences", () => {
      const defaults = createDefaultAppSettings();
      expect(defaults.profiles).toEqual(DEFAULT_PROFILE_PREFERENCES);
      expect(defaults.profiles.autoSwitch).toBe(true);
      expect(defaults.profiles.pollIntervalMs).toBe(1500);
      expect(defaults.profiles.fallbackToDefault).toBe(true);
      expect(defaults.profiles.defaultProfileId).toBeUndefined();
    });

    it("parses valid profile preferences from JSON object", () => {
      const parsed = parseAppSettings({
        schemaVersion: 1,
        profiles: {
          autoSwitch: false,
          pollIntervalMs: 2500,
          fallbackToDefault: false,
          defaultProfileId: "profile-shooter",
        },
      });

      expect(parsed.profiles.autoSwitch).toBe(false);
      expect(parsed.profiles.pollIntervalMs).toBe(2500);
      expect(parsed.profiles.fallbackToDefault).toBe(false);
      expect(parsed.profiles.defaultProfileId).toBe("profile-shooter");
    });

    it("clamps pollIntervalMs to valid bounds [500, 10000]", () => {
      const parsedLow = parseAppSettings({
        schemaVersion: 1,
        profiles: { pollIntervalMs: 100 },
      });
      expect(parsedLow.profiles.pollIntervalMs).toBe(1500); // invalid low defaults to 1500

      const parsedValid = parseAppSettings({
        schemaVersion: 1,
        profiles: { pollIntervalMs: 800 },
      });
      expect(parsedValid.profiles.pollIntervalMs).toBe(800);
    });

    it("round-trips profile preferences through AppSettingsRepository", () => {
      const store = new Map<string, string>();
      const mockStorage = {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
      };

      const repo = new AppSettingsRepository(undefined, mockStorage);
      const initial = repo.load();
      expect(initial.profiles.autoSwitch).toBe(true);

      const modified: AppSettings = {
        ...initial,
        profiles: {
          autoSwitch: false,
          pollIntervalMs: 2000,
          fallbackToDefault: true,
          defaultProfileId: "profile-custom-123",
        },
      };

      repo.save(modified);
      const reloaded = repo.load();
      expect(reloaded.profiles.autoSwitch).toBe(false);
      expect(reloaded.profiles.pollIntervalMs).toBe(2000);
      expect(reloaded.profiles.defaultProfileId).toBe("profile-custom-123");
    });
  });

  describe("ProfileRepository query helpers", () => {
    it("finds profile by package name and resolves default profile", async () => {
      const repo = new ProfileRepository();

      const p1 = createProfile("Shooter");
      p1.game = { title: "Shooter", packageName: "com.shooter.fps" };

      const p2 = createProfile("Default controls");
      p2.game = { title: "Standard" };

      await repo.save(p1);
      await repo.save(p2);

      const found = await repo.findByPackage("com.shooter.fps");
      expect(found?.name).toBe("Shooter");

      const defaultProf = await repo.getDefaultProfile();
      expect(defaultProf.name).toBe("Default controls");

      const explicitDefault = await repo.getDefaultProfile(p1.id);
      expect(explicitDefault.id).toBe(p1.id);
    });
  });
});
