import { describe, expect, it } from "vitest";

import {
  isLauncherPackage,
  normalizeActivityName,
  parseActivityDumpsys,
  parseComponentString,
  parseWindowDumpsys,
} from "../src/capabilities/appDetection";

describe("appDetection parser & helpers", () => {
  describe("parseComponentString", () => {
    it("extracts package and fully qualified activity", () => {
      const result = parseComponentString(
        "com.miHoYo.GenshinImpact/com.miHoYo.GetMobileMainActivity",
      );
      expect(result).toEqual({
        packageName: "com.miHoYo.GenshinImpact",
        activityName: "com.miHoYo.GetMobileMainActivity",
      });
    });

    it("normalizes relative activity notation", () => {
      const result = parseComponentString("com.dts.freefireth/.FFMainActivity");
      expect(result).toEqual({
        packageName: "com.dts.freefireth",
        activityName: "com.dts.freefireth.FFMainActivity",
      });
    });

    it("returns undefined for invalid component strings", () => {
      expect(parseComponentString("not-a-component")).toBeUndefined();
      expect(parseComponentString("")).toBeUndefined();
    });
  });

  describe("normalizeActivityName", () => {
    it("prepends package name if activity starts with dot", () => {
      expect(normalizeActivityName("com.game", ".PlayActivity")).toBe(
        "com.game.PlayActivity",
      );
    });

    it("returns activity unchanged if fully qualified", () => {
      expect(normalizeActivityName("com.game", "com.game.PlayActivity")).toBe(
        "com.game.PlayActivity",
      );
    });

    it("handles null or empty activity", () => {
      expect(normalizeActivityName("com.game", undefined)).toBeUndefined();
      expect(normalizeActivityName("com.game", "null")).toBeUndefined();
    });
  });

  describe("parseWindowDumpsys", () => {
    it("parses modern Android mCurrentFocus with user ID prefix", () => {
      const sample = `
        mCurrentFocus=Window{84db45e u0 com.miHoYo.GenshinImpact/com.miHoYo.GetMobileMainActivity}
        mFocusedApp=ActivityRecord{a43f821 u0 com.miHoYo.GenshinImpact/.GetMobileMainActivity t12}
      `;
      const result = parseWindowDumpsys(sample);
      expect(result).toEqual({
        packageName: "com.miHoYo.GenshinImpact",
        activityName: "com.miHoYo.GetMobileMainActivity",
      });
    });

    it("parses Android without user prefix", () => {
      const sample = `
        mCurrentFocus=Window{37b6de2 com.activision.callofduty.shooter/com.tencent.tmgp.cod.MainActivity}
      `;
      const result = parseWindowDumpsys(sample);
      expect(result).toEqual({
        packageName: "com.activision.callofduty.shooter",
        activityName: "com.tencent.tmgp.cod.MainActivity",
      });
    });

    it("prioritizes mFocusedApp when mCurrentFocus is SystemUI overlay (e.g. volume or shade)", () => {
      const sample = `
        mCurrentFocus=Window{abc1234 u0 com.android.systemui/com.android.systemui.volume.VolumeDialogImpl}
        mFocusedApp=ActivityRecord{def5678 u0 com.dts.freefireth/.FFMainActivity t45}
      `;
      const result = parseWindowDumpsys(sample);
      expect(result).toEqual({
        packageName: "com.dts.freefireth",
        activityName: "com.dts.freefireth.FFMainActivity",
      });
    });

    it("handles mCurrentFocus=null by falling back to mFocusedApp", () => {
      const sample = `
        mCurrentFocus=null
        mFocusedApp=ActivityRecord{def5678 u0 com.pubg.imobile/com.epicgames.ue4.SplashActivity t99}
      `;
      const result = parseWindowDumpsys(sample);
      expect(result).toEqual({
        packageName: "com.pubg.imobile",
        activityName: "com.epicgames.ue4.SplashActivity",
      });
    });

    it("handles multi-display output scoping to requested displayId", () => {
      const multiDisplay = `
        Display: mDisplayId=0
          init=1080x2400 420dpi cur=1080x2400
          mCurrentFocus=Window{111 u0 com.google.android.apps.nexuslauncher/.NexusLauncherActivity}
        Display: mDisplayId=1
          init=1920x1080 320dpi cur=1920x1080
          mCurrentFocus=Window{222 u0 com.riotgames.league.wildrift/com.riotgames.league.wildrift.MainActivity}
      `;
      const display0 = parseWindowDumpsys(multiDisplay, 0);
      expect(display0?.packageName).toBe("com.google.android.apps.nexuslauncher");

      const display1 = parseWindowDumpsys(multiDisplay, 1);
      expect(display1?.packageName).toBe("com.riotgames.league.wildrift");
    });

    it("returns undefined for empty or invalid output", () => {
      expect(parseWindowDumpsys("")).toBeUndefined();
      expect(parseWindowDumpsys("no window focus here")).toBeUndefined();
    });
  });

  describe("parseActivityDumpsys", () => {
    it("parses mResumedActivity from dumpsys activity", () => {
      const sample = `
        mResumedActivity: ActivityRecord{412345 u0 com.roblox.client/.ActivityProtocolLaunch t123}
      `;
      const result = parseActivityDumpsys(sample);
      expect(result).toEqual({
        packageName: "com.roblox.client",
        activityName: "com.roblox.client.ActivityProtocolLaunch",
      });
    });

    it("parses topResumedActivity from dumpsys activity", () => {
      const sample = `
        topResumedActivity=ActivityRecord{412345 u0 com.mojang.minecraftpe/com.mojang.minecraftpe.MainActivity t123}
      `;
      const result = parseActivityDumpsys(sample);
      expect(result).toEqual({
        packageName: "com.mojang.minecraftpe",
        activityName: "com.mojang.minecraftpe.MainActivity",
      });
    });

    it("parses ACTIVITY line from dumpsys activity top", () => {
      const sample = `
        TASK com.supercell.clashofclans id=55
          ACTIVITY com.supercell.clashofclans/.GameApp 789abc pid=4567
      `;
      const result = parseActivityDumpsys(sample);
      expect(result).toEqual({
        packageName: "com.supercell.clashofclans",
        activityName: "com.supercell.clashofclans.GameApp",
      });
    });
  });

  describe("isLauncherPackage", () => {
    it("identifies standard OEM launcher packages", () => {
      expect(isLauncherPackage("com.google.android.apps.nexuslauncher")).toBe(true);
      expect(isLauncherPackage("com.sec.android.app.launcher")).toBe(true);
      expect(isLauncherPackage("com.miui.home")).toBe(true);
      expect(isLauncherPackage("com.android.launcher3")).toBe(true);
      expect(isLauncherPackage("com.microsoft.launcher")).toBe(true);
      expect(isLauncherPackage("com.teslacoilsw.launcher")).toBe(true);
    });

    it("identifies custom known launcher passed dynamically", () => {
      expect(isLauncherPackage("custom.oem.desktop", "custom.oem.desktop")).toBe(true);
    });

    it("returns false for games and ordinary apps", () => {
      expect(isLauncherPackage("com.miHoYo.GenshinImpact")).toBe(false);
      expect(isLauncherPackage("com.dts.freefireth")).toBe(false);
      expect(isLauncherPackage("com.android.chrome")).toBe(false);
    });
  });
});
