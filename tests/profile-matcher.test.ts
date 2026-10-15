import { describe, expect, it } from "vitest";

import {
  findProfileForPackage,
  matchesPackage,
  matchesSinglePattern,
  resolveDefaultProfile,
  splitPackagePatterns,
} from "../src/profiles/ProfileMatcher";
import { createProfile, type GameProfile } from "../src/profiles/schema";

describe("ProfileMatcher", () => {
  describe("splitPackagePatterns", () => {
    it("handles comma, semicolon, and whitespace delimiters", () => {
      expect(
        splitPackagePatterns("com.pkg.one, com.pkg.two; com.pkg.three  com.pkg.four"),
      ).toEqual([
        "com.pkg.one",
        "com.pkg.two",
        "com.pkg.three",
        "com.pkg.four",
      ]);
    });

    it("returns empty array for undefined or empty input", () => {
      expect(splitPackagePatterns(undefined)).toEqual([]);
      expect(splitPackagePatterns("   ")).toEqual([]);
    });
  });

  describe("matchesSinglePattern", () => {
    it("matches exact package name case-insensitively", () => {
      expect(
        matchesSinglePattern("com.dts.freefireth", "com.dts.freefireth"),
      ).toEqual({ matches: true, isWildcard: false });
      expect(
        matchesSinglePattern("COM.DTS.FREEFIRETH", "com.dts.freefireth"),
      ).toEqual({ matches: true, isWildcard: false });
      expect(
        matchesSinglePattern("com.dts.freefireth", "com.dts.freefiremax"),
      ).toEqual({ matches: false, isWildcard: false });
    });

    it("matches wildcard prefix pattern", () => {
      expect(
        matchesSinglePattern("com.activision.*", "com.activision.callofduty.shooter"),
      ).toEqual({ matches: true, isWildcard: true });
      expect(
        matchesSinglePattern("com.activision.*", "com.ea.gp.apexlegendsmobilefps"),
      ).toEqual({ matches: false, isWildcard: true });
    });

    it("matches internal wildcard pattern", () => {
      expect(
        matchesSinglePattern("com.*.shooter", "com.activision.shooter"),
      ).toEqual({ matches: true, isWildcard: true });
    });
  });

  describe("matchesPackage", () => {
    it("identifies exact match type for single package", () => {
      const result = matchesPackage("com.roblox.client", "com.roblox.client");
      expect(result).toEqual({ matches: true, matchType: "exact" });
    });

    it("identifies multi match type when matched within token list", () => {
      const result = matchesPackage(
        "com.pubg.imobile, com.tencent.ig, com.pubg.krmobile",
        "com.tencent.ig",
      );
      expect(result).toEqual({ matches: true, matchType: "multi" });
    });

    it("identifies wildcard match type", () => {
      const result = matchesPackage("com.supercell.*", "com.supercell.brawlstars");
      expect(result).toEqual({ matches: true, matchType: "wildcard" });
    });

    it("returns false when no token matches", () => {
      const result = matchesPackage(
        "com.dts.freefireth, com.dts.freefiremax",
        "com.mojang.minecraftpe",
      );
      expect(result).toEqual({ matches: false });
    });
  });

  describe("findProfileForPackage", () => {
    const defaultProfile: GameProfile = {
      ...createProfile("Default controls"),
      id: "profile-default",
    };

    const genshinProfile: GameProfile = {
      ...createProfile("Genshin Impact"),
      id: "profile-genshin",
      game: {
        title: "Genshin Impact",
        packageName: "com.miHoYo.GenshinImpact",
      },
    };

    const pubgProfile: GameProfile = {
      ...createProfile("PUBG Mobile"),
      id: "profile-pubg",
      game: {
        title: "PUBG Mobile",
        packageName: "com.tencent.ig, com.pubg.imobile, com.pubg.krmobile",
      },
    };

    const supercellProfile: GameProfile = {
      ...createProfile("Supercell Games"),
      id: "profile-supercell",
      game: {
        title: "Supercell",
        packageName: "com.supercell.*",
      },
    };

    const profiles = [defaultProfile, genshinProfile, pubgProfile, supercellProfile];

    it("resolves exact single package profile with highest priority", () => {
      const match = findProfileForPackage(profiles, "com.miHoYo.GenshinImpact");
      expect(match).toEqual({
        profile: genshinProfile,
        matchType: "exact",
        matchedPackage: "com.miHoYo.GenshinImpact",
      });
    });

    it("resolves multi-package profile token", () => {
      const match = findProfileForPackage(profiles, "com.pubg.imobile");
      expect(match).toEqual({
        profile: pubgProfile,
        matchType: "multi",
        matchedPackage: "com.pubg.imobile",
      });
    });

    it("resolves wildcard profile when no exact match exists", () => {
      const match = findProfileForPackage(profiles, "com.supercell.clashofclans");
      expect(match).toEqual({
        profile: supercellProfile,
        matchType: "wildcard",
        matchedPackage: "com.supercell.clashofclans",
      });
    });

    it("falls back to default profile when unmapped app is open and fallback enabled", () => {
      const match = findProfileForPackage(profiles, "com.unmapped.randomgame", {
        defaultProfileId: "profile-default",
        fallbackToDefault: true,
      });
      expect(match).toEqual({
        profile: defaultProfile,
        matchType: "default-fallback",
      });
    });

    it("returns default profile when device is on home launcher", () => {
      const match = findProfileForPackage(
        profiles,
        "com.google.android.apps.nexuslauncher",
        {
          defaultProfileId: "profile-default",
          fallbackToDefault: true,
          isLauncherOrHome: true,
        },
      );
      expect(match).toEqual({
        profile: defaultProfile,
        matchType: "default-fallback",
      });
    });

    it("returns undefined when no match and fallback disabled", () => {
      const match = findProfileForPackage(profiles, "com.unmapped.app", {
        fallbackToDefault: false,
      });
      expect(match).toBeUndefined();
    });
  });

  describe("resolveDefaultProfile", () => {
    it("finds by explicit ID", () => {
      const p1 = { ...createProfile("P1"), id: "id-1" };
      const p2 = { ...createProfile("P2"), id: "id-2" };
      expect(resolveDefaultProfile([p1, p2], "id-2")).toBe(p2);
    });

    it("finds profile with 'default' in name", () => {
      const p1 = { ...createProfile("Shooter"), id: "id-1" };
      const p2 = { ...createProfile("Default controls"), id: "id-2" };
      expect(resolveDefaultProfile([p1, p2])).toBe(p2);
    });

    it("falls back to first profile if no id or default in name", () => {
      const p1 = { ...createProfile("Custom A"), id: "id-1" };
      const p2 = { ...createProfile("Custom B"), id: "id-2" };
      expect(resolveDefaultProfile([p1, p2])).toBe(p1);
    });
  });
});
