import { describe, expect, it } from "vitest";

import {
  cloneStreamQuality,
} from "../src/core/types";
import {
  APP_SETTINGS_SCHEMA_VERSION,
  AppSettingsRepository,
  createDefaultAppSettings,
  normalizeStreamQuality,
  parseAppSettings,
  streamQualityIssues,
} from "../src/settings/AppSettings";

class MemoryStorage {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

describe("persistent application settings", () => {
  it("round-trips advanced stream, reconnect, and import preferences", () => {
    const storage = new MemoryStorage();
    const first = new AppSettingsRepository(undefined, storage);
    const settings = createDefaultAppSettings();
    settings.defaultQuality = {
      ...cloneStreamQuality(settings.defaultQuality),
      maxSize: 2560,
      bitRate: 18_000_000,
      maxFps: 90,
      codec: "h265",
      iFrameInterval: 2,
      renderer: "bitmap",
      hardwareAcceleration: "prefer-software",
      tunnel: "forward",
      captureOrientation: "90",
      stayAwake: true,
      mouse: {
        mode: "sdk",
        sensitivity: 1.75,
        rawInput: false,
      },
      audio: {
        ...settings.defaultQuality.audio,
        codec: "opus",
        bitRate: 192_000,
        bufferMs: 35,
      },
    };
    settings.devices = [
      { serial: "DEVICE-1", quality: settings.defaultQuality },
    ];
    settings.imports = {
      conflictStrategy: "replace",
      activateAfterImport: false,
      errorStrategy: "stop",
      maxFileSizeMb: 10,
    };
    settings.connection = {
      autoReconnect: true,
      resumeStream: false,
    };
    first.save(settings);

    const restored = new AppSettingsRepository(undefined, storage).load();
    expect(restored).toEqual(settings);
    expect(restored.schemaVersion).toBe(APP_SETTINGS_SCHEMA_VERSION);
  });

  it("defensively restores defaults for invalid fields", () => {
    const parsed = parseAppSettings({
      schemaVersion: APP_SETTINGS_SCHEMA_VERSION,
      defaultQuality: {
        maxSize: -1,
        bitRate: Infinity,
        maxFps: 999,
        codec: "unknown",
        crop: "bad",
        mouse: {
          mode: "touch",
          sensitivity: 99,
          rawInput: "yes",
        },
        audio: {
          volume: 5,
          codec: "mp3",
          bitRate: 1,
          bufferMs: 5_000,
        },
      },
      devices: [
        { serial: "", quality: {} },
        { serial: "VALID", quality: { maxSize: 1280 } },
      ],
      imports: {
        conflictStrategy: "overwrite-everything",
        maxFileSizeMb: 500,
      },
      connection: {
        autoReconnect: "yes",
      },
    });

    const defaults = createDefaultAppSettings();
    expect(parsed.defaultQuality).toEqual(defaults.defaultQuality);
    expect(parsed.devices).toHaveLength(1);
    expect(parsed.devices[0]!.serial).toBe("VALID");
    expect(parsed.imports).toEqual(defaults.imports);
    expect(parsed.connection).toEqual(defaults.connection);
  });

  it("reports invalid live values before a stream restart", () => {
    const quality = normalizeStreamQuality({});
    quality.crop = "1920x1080";
    quality.maxFps = 300;
    quality.audio.bufferMs = 10;
    quality.mouse.sensitivity = 8;

    expect(streamQualityIssues(quality)).toEqual([
      "Frame limit must be 0–240 fps.",
      "Crop must use width:height:x:y with positive dimensions.",
      "Audio buffer must be 20–500 ms.",
      "Mouse sensitivity must be 0.1–4×.",
    ]);
  });

  it("persists an explicit direct-mouse disabled mode", () => {
    const quality = normalizeStreamQuality({
      mouse: {
        mode: "disabled",
        sensitivity: 1,
        rawInput: true,
      },
    });

    expect(quality.mouse.mode).toBe("disabled");
  });
});
