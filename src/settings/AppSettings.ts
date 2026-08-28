import {
  DEFAULT_STREAM_QUALITY,
  cloneStreamQuality,
  type AudioCodecPreference,
  type CaptureOrientation,
  type DecoderHardwareAcceleration,
  type MouseInputMode,
  type RendererPreference,
  type StreamQuality,
  type TunnelPreference,
  type VideoCodec,
} from "../core/types";
import type { Diagnostics } from "../debug/Diagnostics";

export const APP_SETTINGS_SCHEMA_VERSION = 1 as const;

export type ImportConflictStrategy = "copy" | "replace" | "skip";
export type ImportErrorStrategy = "continue" | "stop";

export interface ImportPreferences {
  conflictStrategy: ImportConflictStrategy;
  activateAfterImport: boolean;
  errorStrategy: ImportErrorStrategy;
  maxFileSizeMb: number;
}

export interface ConnectionPreferences {
  autoReconnect: boolean;
  resumeStream: boolean;
}

export interface DeviceStreamSettings {
  serial: string;
  quality: StreamQuality;
}

export interface AppSettings {
  schemaVersion: typeof APP_SETTINGS_SCHEMA_VERSION;
  defaultQuality: StreamQuality;
  devices: DeviceStreamSettings[];
  imports: ImportPreferences;
  connection: ConnectionPreferences;
}

export const DEFAULT_IMPORT_PREFERENCES: ImportPreferences = {
  conflictStrategy: "copy",
  activateAfterImport: true,
  errorStrategy: "continue",
  maxFileSizeMb: 2,
};

export const DEFAULT_CONNECTION_PREFERENCES: ConnectionPreferences = {
  autoReconnect: true,
  resumeStream: true,
};

const STORAGE_KEY = "opendroid-remote.settings.v1";
const VIDEO_CODECS = new Set<"auto" | VideoCodec>([
  "auto",
  "h264",
  "h265",
  "av1",
]);
const AUDIO_CODECS = new Set<AudioCodecPreference>([
  "auto",
  "raw",
  "opus",
  "aac",
  "flac",
]);
const RENDERERS = new Set<RendererPreference>([
  "auto",
  "webgl",
  "bitmap",
]);
const HARDWARE_PREFERENCES = new Set<DecoderHardwareAcceleration>([
  "no-preference",
  "prefer-hardware",
  "prefer-software",
]);
const MOUSE_INPUT_MODES = new Set<MouseInputMode>([
  "uhid",
  "sdk",
  "disabled",
]);
const TUNNELS = new Set<TunnelPreference>([
  "auto",
  "reverse",
  "forward",
]);
const CAPTURE_ORIENTATIONS = new Set<CaptureOrientation>([
  "auto",
  "initial",
  "0",
  "90",
  "180",
  "270",
]);
const CONFLICT_STRATEGIES = new Set<ImportConflictStrategy>([
  "copy",
  "replace",
  "skip",
]);
const ERROR_STRATEGIES = new Set<ImportErrorStrategy>(["continue", "stop"]);

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function numberInRange(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= min &&
    value <= max
    ? value
    : fallback;
}

function integerInRange(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  return Number.isInteger(value) &&
    (value as number) >= min &&
    (value as number) <= max
    ? (value as number)
    : fallback;
}

function optionalSafeText(
  value: unknown,
  maximumLength: number,
): string | undefined {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximumLength ||
    // eslint-disable-next-line no-control-regex
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    return undefined;
  }
  return value;
}

export function isValidCrop(value: string | undefined): boolean {
  if (value === undefined || value === "") return true;
  const match = /^(\d+):(\d+):(\d+):(\d+)$/.exec(value);
  if (!match) return false;
  const [width, height, x, y] = match
    .slice(1)
    .map((part) => Number(part));
  return (
    width! > 0 &&
    height! > 0 &&
    width! <= 16_384 &&
    height! <= 16_384 &&
    x! >= 0 &&
    y! >= 0 &&
    x! <= 16_384 &&
    y! <= 16_384
  );
}

export function normalizeStreamQuality(
  value: unknown,
  fallback: StreamQuality = DEFAULT_STREAM_QUALITY,
): StreamQuality {
  if (!isRecord(value)) return cloneStreamQuality(fallback);
  const audio = isRecord(value.audio) ? value.audio : {};
  const mouse = isRecord(value.mouse) ? value.mouse : {};
  const codec = VIDEO_CODECS.has(value.codec as "auto" | VideoCodec)
    ? (value.codec as "auto" | VideoCodec)
    : fallback.codec;
  const audioCodec = AUDIO_CODECS.has(
    audio.codec as AudioCodecPreference,
  )
    ? (audio.codec as AudioCodecPreference)
    : fallback.audio.codec;
  const renderer = RENDERERS.has(value.renderer as RendererPreference)
    ? (value.renderer as RendererPreference)
    : fallback.renderer;
  const hardwareAcceleration = HARDWARE_PREFERENCES.has(
    value.hardwareAcceleration as DecoderHardwareAcceleration,
  )
    ? (value.hardwareAcceleration as DecoderHardwareAcceleration)
    : fallback.hardwareAcceleration;
  const tunnel = TUNNELS.has(value.tunnel as TunnelPreference)
    ? (value.tunnel as TunnelPreference)
    : fallback.tunnel;
  const captureOrientation = CAPTURE_ORIENTATIONS.has(
    value.captureOrientation as CaptureOrientation,
  )
    ? (value.captureOrientation as CaptureOrientation)
    : fallback.captureOrientation;
  const crop = optionalSafeText(value.crop, 64);
  const encoder = optionalSafeText(value.encoder, 256);
  const audioEncoder = optionalSafeText(audio.encoder, 256);

  return {
    maxSize: integerInRange(
      value.maxSize,
      fallback.maxSize,
      0,
      8_192,
    ),
    bitRate: integerInRange(
      value.bitRate,
      fallback.bitRate,
      100_000,
      100_000_000,
    ),
    maxFps: integerInRange(value.maxFps, fallback.maxFps, 0, 240),
    codec,
    ...(encoder ? { encoder } : {}),
    ...(Number.isInteger(value.displayId) &&
    (value.displayId as number) >= 0 &&
    (value.displayId as number) <= 65_535
      ? { displayId: value.displayId as number }
      : {}),
    ...(crop && isValidCrop(crop) ? { crop } : {}),
    ...(typeof value.iFrameInterval === "number" &&
    Number.isFinite(value.iFrameInterval) &&
    value.iFrameInterval >= 0 &&
    value.iFrameInterval <= 60
      ? { iFrameInterval: value.iFrameInterval }
      : {}),
    captureOrientation,
    renderer,
    hardwareAcceleration,
    tunnel,
    downsizeOnError:
      typeof value.downsizeOnError === "boolean"
        ? value.downsizeOnError
        : fallback.downsizeOnError,
    powerOn:
      typeof value.powerOn === "boolean" ? value.powerOn : fallback.powerOn,
    stayAwake:
      typeof value.stayAwake === "boolean"
        ? value.stayAwake
        : fallback.stayAwake,
    showTouches:
      typeof value.showTouches === "boolean"
        ? value.showTouches
        : fallback.showTouches,
    clipboardAutosync:
      typeof value.clipboardAutosync === "boolean"
        ? value.clipboardAutosync
        : fallback.clipboardAutosync,
    mouse: {
      mode: MOUSE_INPUT_MODES.has(mouse.mode as MouseInputMode)
        ? (mouse.mode as MouseInputMode)
        : fallback.mouse.mode,
      sensitivity: numberInRange(
        mouse.sensitivity,
        fallback.mouse.sensitivity,
        0.1,
        4,
      ),
      rawInput:
        typeof mouse.rawInput === "boolean"
          ? mouse.rawInput
          : fallback.mouse.rawInput,
    },
    audio: {
      enabled:
        typeof audio.enabled === "boolean"
          ? audio.enabled
          : fallback.audio.enabled,
      duplicateOnDevice:
        typeof audio.duplicateOnDevice === "boolean"
          ? audio.duplicateOnDevice
          : fallback.audio.duplicateOnDevice,
      volume: numberInRange(
        audio.volume,
        fallback.audio.volume,
        0,
        1,
      ),
      codec: audioCodec,
      bitRate: integerInRange(
        audio.bitRate,
        fallback.audio.bitRate,
        16_000,
        1_000_000,
      ),
      ...(audioEncoder ? { encoder: audioEncoder } : {}),
      bufferMs: integerInRange(
        audio.bufferMs,
        fallback.audio.bufferMs,
        20,
        500,
      ),
    },
  };
}

export function streamQualityIssues(quality: StreamQuality): string[] {
  const issues: string[] = [];
  if (!Number.isInteger(quality.maxSize) || quality.maxSize < 0 || quality.maxSize > 8_192) {
    issues.push("Maximum dimension must be 0–8192 pixels.");
  }
  if (
    !Number.isInteger(quality.bitRate) ||
    quality.bitRate < 100_000 ||
    quality.bitRate > 100_000_000
  ) {
    issues.push("Video bitrate must be 0.1–100 Mbps.");
  }
  if (!Number.isInteger(quality.maxFps) || quality.maxFps < 0 || quality.maxFps > 240) {
    issues.push("Frame limit must be 0–240 fps.");
  }
  if (!isValidCrop(quality.crop)) {
    issues.push("Crop must use width:height:x:y with positive dimensions.");
  }
  if (
    quality.iFrameInterval !== undefined &&
    (!Number.isFinite(quality.iFrameInterval) ||
      quality.iFrameInterval < 0 ||
      quality.iFrameInterval > 60)
  ) {
    issues.push("I-frame interval must be 0–60 seconds.");
  }
  if (
    !Number.isInteger(quality.audio.bitRate) ||
    quality.audio.bitRate < 16_000 ||
    quality.audio.bitRate > 1_000_000
  ) {
    issues.push("Audio bitrate must be 16–1000 kbps.");
  }
  if (
    !Number.isInteger(quality.audio.bufferMs) ||
    quality.audio.bufferMs < 20 ||
    quality.audio.bufferMs > 500
  ) {
    issues.push("Audio buffer must be 20–500 ms.");
  }
  if (
    !Number.isFinite(quality.mouse.sensitivity) ||
    quality.mouse.sensitivity < 0.1 ||
    quality.mouse.sensitivity > 4
  ) {
    issues.push("Mouse sensitivity must be 0.1–4×.");
  }
  return issues;
}

export function createDefaultAppSettings(): AppSettings {
  return {
    schemaVersion: APP_SETTINGS_SCHEMA_VERSION,
    defaultQuality: cloneStreamQuality(),
    devices: [],
    imports: { ...DEFAULT_IMPORT_PREFERENCES },
    connection: { ...DEFAULT_CONNECTION_PREFERENCES },
  };
}

export function parseAppSettings(value: unknown): AppSettings {
  const defaults = createDefaultAppSettings();
  if (
    !isRecord(value) ||
    value.schemaVersion !== APP_SETTINGS_SCHEMA_VERSION
  ) {
    return defaults;
  }
  const imports = isRecord(value.imports) ? value.imports : {};
  const connection = isRecord(value.connection) ? value.connection : {};
  const devices: DeviceStreamSettings[] = [];
  if (Array.isArray(value.devices)) {
    for (const item of value.devices) {
      if (
        !isRecord(item) ||
        typeof item.serial !== "string" ||
        item.serial.length === 0 ||
        item.serial.length > 512 ||
        devices.some((current) => current.serial === item.serial)
      ) {
        continue;
      }
      devices.push({
        serial: item.serial,
        quality: normalizeStreamQuality(item.quality),
      });
      if (devices.length >= 64) break;
    }
  }

  return {
    schemaVersion: APP_SETTINGS_SCHEMA_VERSION,
    defaultQuality: normalizeStreamQuality(value.defaultQuality),
    devices,
    imports: {
      conflictStrategy: CONFLICT_STRATEGIES.has(
        imports.conflictStrategy as ImportConflictStrategy,
      )
        ? (imports.conflictStrategy as ImportConflictStrategy)
        : defaults.imports.conflictStrategy,
      activateAfterImport:
        typeof imports.activateAfterImport === "boolean"
          ? imports.activateAfterImport
          : defaults.imports.activateAfterImport,
      errorStrategy: ERROR_STRATEGIES.has(
        imports.errorStrategy as ImportErrorStrategy,
      )
        ? (imports.errorStrategy as ImportErrorStrategy)
        : defaults.imports.errorStrategy,
      maxFileSizeMb: integerInRange(
        imports.maxFileSizeMb,
        defaults.imports.maxFileSizeMb,
        1,
        50,
      ),
    },
    connection: {
      autoReconnect:
        typeof connection.autoReconnect === "boolean"
          ? connection.autoReconnect
          : defaults.connection.autoReconnect,
      resumeStream:
        typeof connection.resumeStream === "boolean"
          ? connection.resumeStream
          : defaults.connection.resumeStream,
    },
  };
}

export class AppSettingsRepository {
  #memory = createDefaultAppSettings();

  constructor(
    private readonly diagnostics?: Diagnostics,
    private readonly storage: StorageLike | undefined =
      typeof localStorage === "undefined" ? undefined : localStorage,
  ) {}

  load(): AppSettings {
    if (!this.storage) return structuredClone(this.#memory);
    try {
      const raw = this.storage.getItem(STORAGE_KEY);
      const settings = raw
        ? parseAppSettings(JSON.parse(raw) as unknown)
        : createDefaultAppSettings();
      this.#memory = settings;
      return structuredClone(settings);
    } catch (error) {
      this.diagnostics?.warn(
        "settings",
        "settings-load-failed",
        "Saved application settings were invalid; automatic defaults were restored.",
        error,
      );
      this.#memory = createDefaultAppSettings();
      return structuredClone(this.#memory);
    }
  }

  save(value: AppSettings): AppSettings {
    const settings = parseAppSettings(value);
    this.#memory = settings;
    if (this.storage) {
      try {
        this.storage.setItem(STORAGE_KEY, JSON.stringify(settings));
      } catch (error) {
        this.diagnostics?.warn(
          "settings",
          "settings-save-failed",
          "Application settings could not be written to localStorage.",
          error,
        );
      }
    }
    return structuredClone(settings);
  }
}
