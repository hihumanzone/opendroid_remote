import { AdbScrcpyOptionsLatest } from "@yume-chan/adb-scrcpy";

import type {
  AudioCodec,
  StreamQuality,
} from "../core/types";

export function createAudioSessionOptions(
  audio: StreamQuality["audio"],
  codec: AudioCodec = audio.codec === "auto" ? "raw" : audio.codec,
) {
  const duplicateOnDevice = audio.enabled && audio.duplicateOnDevice;
  return {
    audio: audio.enabled,
    audioCodec: codec,
    audioBitRate: audio.bitRate,
    audioEncoder: codec === "raw" ? undefined : audio.encoder,
    audioSource: duplicateOnDevice
      ? ("playback" as const)
      : ("output" as const),
    audioDup: duplicateOnDevice,
  };
}

/**
 * Capability queries are consecutive one-shot scrcpy processes that share the
 * same pushed server file. They must not use scrcpy's default cleanup behavior,
 * because the first query would delete the server before the next query or
 * streaming launch.
 */
export function createDiscoveryOptions(): AdbScrcpyOptionsLatest<true> {
  return new AdbScrcpyOptionsLatest({
    video: true,
    audio: false,
    control: false,
    cleanup: false,
    // scrcpy advertises list entries at INFO level. WARN suppresses the lines
    // parsed by AdbScrcpyClient.getDisplays/getEncoders.
    logLevel: "info",
  });
}
