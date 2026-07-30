import type { ScrcpyEncoder } from "@yume-chan/scrcpy";

import type {
  AudioCodec,
  AudioEncoderDescriptor,
  EncoderDescriptor,
  TunnelPreference,
  VideoCodec,
} from "../core/types";
import type { Diagnostics } from "../debug/Diagnostics";

export interface BrowserCodecSupport {
  h264: boolean;
  h265: boolean;
  av1: boolean;
}

export interface CodecCandidate {
  codec: VideoCodec;
  encoder?: string;
  reason: string;
}

export interface StartupAttempt {
  candidate: CodecCandidate;
  tunnelForward: boolean;
  tunnelLabel: string;
}

const PROBE_CONFIGS: Record<VideoCodec, VideoDecoderConfig> = {
  h264: {
    codec: "avc1.42E01E",
    hardwareAcceleration: "no-preference",
    optimizeForLatency: true,
  },
  h265: {
    codec: "hev1.1.6.L93.B0",
    codedWidth: 1280,
    codedHeight: 720,
    hardwareAcceleration: "no-preference",
    optimizeForLatency: true,
  },
  av1: {
    codec: "av01.0.05M.08",
    hardwareAcceleration: "no-preference",
    optimizeForLatency: true,
  },
};

export async function probeBrowserCodecs(
  diagnostics?: Diagnostics,
): Promise<BrowserCodecSupport> {
  if (typeof VideoDecoder === "undefined") {
    return { h264: false, h265: false, av1: false };
  }
  const result: BrowserCodecSupport = { h264: false, h265: false, av1: false };
  for (const codec of Object.keys(PROBE_CONFIGS) as VideoCodec[]) {
    try {
      const support = await VideoDecoder.isConfigSupported(PROBE_CONFIGS[codec]);
      result[codec] = Boolean(support.supported);
    } catch (error) {
      diagnostics?.debug(
        "codec",
        "browser-codec-probe-failed",
        `Browser codec probe failed for ${codec}.`,
        error,
      );
    }
  }
  diagnostics?.info(
    "codec",
    "browser-codecs",
    "Detected browser video decoder capabilities.",
    result,
  );
  return result;
}

export function normalizeEncoders(
  encoders: readonly ScrcpyEncoder[],
): EncoderDescriptor[] {
  return encoders.flatMap((encoder) => {
    if (
      encoder.type !== "video" ||
      (encoder.codec !== "h264" &&
        encoder.codec !== "h265" &&
        encoder.codec !== "av1")
    ) {
      return [];
    }
    return [
      {
        codec: encoder.codec,
        name: encoder.name,
        hardwareType: encoder.hardwareType,
        vendor: encoder.vendor,
        aliasFor: encoder.aliasFor,
      },
    ];
  });
}

export function normalizeAudioEncoders(
  encoders: readonly ScrcpyEncoder[],
): AudioEncoderDescriptor[] {
  return encoders.flatMap((encoder) => {
    if (
      encoder.type !== "audio" ||
      (encoder.codec !== "opus" &&
        encoder.codec !== "aac" &&
        encoder.codec !== "flac")
    ) {
      return [];
    }
    return [
      {
        codec: encoder.codec as Exclude<AudioCodec, "raw">,
        name: encoder.name,
        hardwareType: encoder.hardwareType,
        vendor: encoder.vendor,
        aliasFor: encoder.aliasFor,
      },
    ];
  });
}

function encoderScore(encoder: EncoderDescriptor): number {
  const hardware =
    encoder.hardwareType === "hardware"
      ? 0
      : encoder.hardwareType === "hybrid"
        ? 1
        : encoder.hardwareType === undefined
          ? 2
          : 3;
  return hardware + (encoder.aliasFor ? 10 : 0);
}

export function buildCodecCandidates(
  encoders: readonly EncoderDescriptor[],
  support: BrowserCodecSupport,
  requested: "auto" | VideoCodec,
  requestedEncoder?: string,
): CodecCandidate[] {
  const codecOrder: VideoCodec[] =
    requested === "auto" ? ["h264", "h265", "av1"] : [requested];
  const result: CodecCandidate[] = [];
  const hasEncoderInventory = encoders.length > 0;
  for (const codec of codecOrder) {
    if (!support[codec]) continue;
    const matching = encoders
      .filter(
        (encoder) =>
          encoder.codec === codec &&
          (!requestedEncoder || encoder.name === requestedEncoder),
      )
      .sort((a, b) => encoderScore(a) - encoderScore(b));
    if (!requestedEncoder && (!hasEncoderInventory || matching.length > 0)) {
      result.push({
        codec,
        reason: `${codec} with Android's negotiated default encoder`,
      });
    }
    for (const encoder of matching) {
      result.push({
        codec,
        encoder: encoder.name,
        reason: `${codec} via ${encoder.name} (${encoder.hardwareType ?? "unclassified"})`,
      });
    }
  }
  return result.filter(
    (candidate, index, all) =>
      all.findIndex(
        (item) =>
          item.codec === candidate.codec && item.encoder === candidate.encoder,
      ) === index,
  );
}

export function buildStartupAttempts(
  candidates: readonly CodecCandidate[],
  tunnel: TunnelPreference = "auto",
): StartupAttempt[] {
  return candidates.flatMap((candidate) => {
    if (tunnel === "forward") {
      return [
        {
          candidate,
          tunnelForward: true,
          tunnelLabel: "forced ADB forward tunnel",
        },
      ];
    }
    const preferred = {
      candidate,
      tunnelForward: false,
      tunnelLabel:
        tunnel === "reverse"
          ? "preferred ADB reverse tunnel"
          : "automatic reverse/forward tunnel",
    };
    return tunnel === "reverse"
      ? [preferred]
      : [
          preferred,
          {
            candidate,
            tunnelForward: true,
            tunnelLabel: "forced ADB forward tunnel",
          },
        ];
  });
}
