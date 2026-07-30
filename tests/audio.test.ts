import { describe, expect, it } from "vitest";

import {
  DEFAULT_STREAM_QUALITY,
} from "../src/core/types";
import {
  decodePcmS16LeStereo,
  SCRCPY_RAW_AUDIO_CHANNELS,
  SCRCPY_RAW_AUDIO_SAMPLE_RATE,
} from "../src/scrcpy/PcmAudioPlayer";
import { createAudioSessionOptions } from "../src/scrcpy/sessionOptions";
import { resolveAudioCodec } from "../src/scrcpy/ScrcpySession";

describe("scrcpy raw audio", () => {
  it("decodes signed 16-bit little-endian stereo samples", () => {
    const decoded = decodePcmS16LeStereo(
      new Uint8Array([
        0x00, 0x80, 0xff, 0x7f, // left min, right max
        0x00, 0x00, 0x00, 0xc0, // left zero, right -0.5
      ]),
    );

    expect(SCRCPY_RAW_AUDIO_SAMPLE_RATE).toBe(48_000);
    expect(SCRCPY_RAW_AUDIO_CHANNELS).toBe(2);
    expect([...decoded.left]).toEqual([-1, 0]);
    expect(decoded.right[0]).toBe(1);
    expect(decoded.right[1]).toBeCloseTo(-0.5, 5);
    expect(decoded.carry).toHaveLength(0);
  });

  it("carries an incomplete stereo frame across packet boundaries", () => {
    const first = decodePcmS16LeStereo(
      new Uint8Array([0x00, 0x40, 0x00]),
    );
    expect(first.left).toHaveLength(0);
    expect([...first.carry]).toEqual([0x00, 0x40, 0x00]);

    const second = decodePcmS16LeStereo(
      new Uint8Array([0xc0, 0x00, 0x20, 0x00, 0xe0]),
      first.carry,
    );
    expect(second.left[0]).toBeCloseTo(0.5, 4);
    expect(second.right[0]).toBeCloseTo(-0.5, 5);
    expect(second.left[1]).toBeCloseTo(0.25, 4);
    expect(second.right[1]).toBeCloseTo(-0.25, 5);
    expect(second.carry).toHaveLength(0);
  });

  it("uses scrcpy playback duplication only while computer audio is enabled", () => {
    expect(
      createAudioSessionOptions({
        ...DEFAULT_STREAM_QUALITY.audio,
        enabled: true,
        duplicateOnDevice: true,
      }),
    ).toEqual({
      audio: true,
      audioCodec: "raw",
      audioBitRate: 128_000,
      audioEncoder: undefined,
      audioSource: "playback",
      audioDup: true,
    });
    expect(
      createAudioSessionOptions({
        ...DEFAULT_STREAM_QUALITY.audio,
        enabled: false,
        duplicateOnDevice: true,
      }),
    ).toEqual({
      audio: false,
      audioCodec: "raw",
      audioBitRate: 128_000,
      audioEncoder: undefined,
      audioSource: "output",
      audioDup: false,
    });
  });

  it("selects only browser-supported audio codecs", () => {
    const support = {
      raw: true,
      opus: true,
      aac: false,
      flac: false,
    };
    expect(resolveAudioCodec("auto", support)).toBe("raw");
    expect(resolveAudioCodec("opus", support)).toBe("opus");
    expect(() => resolveAudioCodec("aac", support)).toThrow(
      /cannot decode.*aac/i,
    );
  });
});
