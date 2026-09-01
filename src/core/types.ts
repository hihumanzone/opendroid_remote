export type ConnectionPhase =
  | "idle"
  | "discovering"
  | "authorizing"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnecting"
  | "error";

export interface DeviceDescriptor {
  serial: string;
  name: string;
  model?: string;
  label: string;
  vendorId: number;
  productId: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface NormalizedPoint {
  x: number;
  y: number;
}

export interface DisplayDescriptor {
  id: number;
  resolution?: string;
  width?: number;
  height?: number;
  focused: boolean;
}

export type VideoCodec = "h264" | "h265" | "av1";
export type AudioCodec = "raw" | "opus" | "aac" | "flac";
export type AudioCodecPreference = "auto" | AudioCodec;
export type RendererPreference = "auto" | "webgl" | "bitmap";
export type TunnelPreference = "auto" | "reverse" | "forward";
export type CaptureOrientation =
  | "auto"
  | "initial"
  | "0"
  | "90"
  | "180"
  | "270";
export type DecoderHardwareAcceleration =
  | "no-preference"
  | "prefer-hardware"
  | "prefer-software";
export type MouseInputMode = "uhid" | "sdk" | "touch" | "disabled";

export interface MouseInputSettings {
  /**
   * `uhid` creates a virtual HID mouse in Android's kernel, matching a
   * physically attached mouse. `sdk` is an explicit compatibility mode that
   * uses scrcpy's absolute Android input path. `touch` converts mouse clicks
   * and drags directly to touchscreen taps without sending hover motion.
   * `disabled` suppresses direct mouse input while leaving explicit touch
   * mappings available.
   */
  mode: MouseInputMode;
  sensitivity: number;
  rawInput: boolean;
}

export interface EncoderDescriptor {
  codec: VideoCodec;
  name: string;
  hardwareType?: "hardware" | "software" | "hybrid";
  vendor?: boolean;
  aliasFor?: string;
}

export interface AudioEncoderDescriptor {
  codec: Exclude<AudioCodec, "raw">;
  name: string;
  hardwareType?: "hardware" | "software" | "hybrid";
  vendor?: boolean;
  aliasFor?: string;
}

export interface StreamQuality {
  maxSize: number;
  bitRate: number;
  maxFps: number;
  codec: "auto" | VideoCodec;
  encoder?: string;
  displayId?: number;
  crop?: string;
  iFrameInterval?: number;
  captureOrientation: CaptureOrientation;
  renderer: RendererPreference;
  hardwareAcceleration: DecoderHardwareAcceleration;
  tunnel: TunnelPreference;
  downsizeOnError: boolean;
  powerOn: boolean;
  stayAwake: boolean;
  showTouches: boolean;
  clipboardAutosync: boolean;
  mouse: MouseInputSettings;
  audio: {
    enabled: boolean;
    duplicateOnDevice: boolean;
    volume: number;
    codec: AudioCodecPreference;
    bitRate: number;
    encoder?: string;
    bufferMs: number;
  };
}

export const DEFAULT_STREAM_QUALITY: StreamQuality = {
  maxSize: 1920,
  bitRate: 8_000_000,
  maxFps: 60,
  codec: "auto",
  captureOrientation: "auto",
  renderer: "auto",
  hardwareAcceleration: "no-preference",
  tunnel: "auto",
  downsizeOnError: true,
  powerOn: true,
  stayAwake: false,
  showTouches: false,
  clipboardAutosync: true,
  mouse: {
    mode: "uhid",
    sensitivity: 1,
    rawInput: true,
  },
  audio: {
    enabled: true,
    duplicateOnDevice: false,
    volume: 1,
    codec: "auto",
    bitRate: 128_000,
    bufferMs: 60,
  },
};

export function cloneStreamQuality(
  quality: StreamQuality = DEFAULT_STREAM_QUALITY,
): StreamQuality {
  return {
    ...quality,
    mouse: { ...quality.mouse },
    audio: { ...quality.audio },
  };
}

export interface SessionStats {
  framesRendered: number;
  framesSkipped: number;
  width: number;
  height: number;
  codec?: VideoCodec;
  encoder?: string;
  displayId?: number;
}

export function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value));
}

export function assertNever(value: never): never {
  throw new Error(`Unexpected value: ${String(value)}`);
}
