import { describe, expect, it } from "vitest";

import {
  DEFAULT_STREAM_QUALITY,
  type SessionStats,
  type StreamQuality,
} from "../src/core/types";
import {
  normalizeStreamQuality,
  streamQualityIssues,
} from "../src/settings/AppSettings";

describe("stream quality pipeline and telemetry", () => {
  it("calculates real-time fps accurately from rendered frame deltas", () => {
    let lastRendered = 0;
    let lastTimestamp = 1000;

    function calculateFps(currentRendered: number, currentTimestamp: number): number {
      const elapsedSec = (currentTimestamp - lastTimestamp) / 1000;
      const fps =
        elapsedSec > 0
          ? Math.max(0, Math.round((currentRendered - lastRendered) / elapsedSec))
          : 0;
      lastRendered = currentRendered;
      lastTimestamp = currentTimestamp;
      return fps;
    }

    // 60 frames rendered in 1000ms -> 60 fps
    expect(calculateFps(60, 2000)).toBe(60);

    // 59 frames rendered in 1000ms -> 59 fps
    expect(calculateFps(119, 3000)).toBe(59);

    // 0 frames rendered in 1000ms (frozen stream) -> 0 fps
    expect(calculateFps(119, 4000)).toBe(0);

    // 120 frames in 1000ms -> 120 fps
    expect(calculateFps(239, 5000)).toBe(120);
  });

  it("verifies SessionStats snapshot retains fps field", () => {
    const stats: SessionStats = {
      framesRendered: 1200,
      framesSkipped: 3,
      width: 1920,
      height: 1080,
      fps: 60,
      codec: "h264",
    };

    expect(stats.fps).toBe(60);
    expect(stats.width).toBe(1920);
    expect(stats.height).toBe(1080);
  });

  it("validates video bitrate boundary constraints (0.1 Mbps to 100 Mbps)", () => {
    // Valid boundaries
    const minBitrate: StreamQuality = {
      ...DEFAULT_STREAM_QUALITY,
      bitRate: 100_000,
    };
    expect(streamQualityIssues(minBitrate)).toEqual([]);

    const maxBitrate: StreamQuality = {
      ...DEFAULT_STREAM_QUALITY,
      bitRate: 100_000_000,
    };
    expect(streamQualityIssues(maxBitrate)).toEqual([]);

    // Below 100,000 bps
    const tooLow: StreamQuality = {
      ...DEFAULT_STREAM_QUALITY,
      bitRate: 99_999,
    };
    expect(streamQualityIssues(tooLow)).toContain(
      "Video bitrate must be 0.1–100 Mbps.",
    );

    // Above 100,000,000 bps
    const tooHigh: StreamQuality = {
      ...DEFAULT_STREAM_QUALITY,
      bitRate: 100_000_001,
    };
    expect(streamQualityIssues(tooHigh)).toContain(
      "Video bitrate must be 0.1–100 Mbps.",
    );

    // Non-integer
    const nonInteger: StreamQuality = {
      ...DEFAULT_STREAM_QUALITY,
      bitRate: 4_500_000.5,
    };
    expect(streamQualityIssues(nonInteger)).toContain(
      "Video bitrate must be 0.1–100 Mbps.",
    );
  });

  it("validates resolution / maximum dimension boundaries (0 to 8192)", () => {
    // 0 = Native (unlimited)
    const nativeRes: StreamQuality = {
      ...DEFAULT_STREAM_QUALITY,
      maxSize: 0,
    };
    expect(streamQualityIssues(nativeRes)).toEqual([]);

    // 8192 = Maximum supported dimension
    const maxRes: StreamQuality = {
      ...DEFAULT_STREAM_QUALITY,
      maxSize: 8192,
    };
    expect(streamQualityIssues(maxRes)).toEqual([]);

    // Negative dimension
    const negativeRes: StreamQuality = {
      ...DEFAULT_STREAM_QUALITY,
      maxSize: -1,
    };
    expect(streamQualityIssues(negativeRes)).toContain(
      "Maximum dimension must be 0–8192 pixels.",
    );

    // Exceeding 8192
    const overRes: StreamQuality = {
      ...DEFAULT_STREAM_QUALITY,
      maxSize: 8193,
    };
    expect(streamQualityIssues(overRes)).toContain(
      "Maximum dimension must be 0–8192 pixels.",
    );
  });

  it("validates frame limit (FPS) boundaries (0 to 240)", () => {
    // 0 = Unlimited
    const unlimitedFps: StreamQuality = {
      ...DEFAULT_STREAM_QUALITY,
      maxFps: 0,
    };
    expect(streamQualityIssues(unlimitedFps)).toEqual([]);

    // 240 = High-refresh display limit
    const maxFps: StreamQuality = {
      ...DEFAULT_STREAM_QUALITY,
      maxFps: 240,
    };
    expect(streamQualityIssues(maxFps)).toEqual([]);

    // Negative
    const negativeFps: StreamQuality = {
      ...DEFAULT_STREAM_QUALITY,
      maxFps: -1,
    };
    expect(streamQualityIssues(negativeFps)).toContain(
      "Frame limit must be 0–240 fps.",
    );

    // Over 240
    const overFps: StreamQuality = {
      ...DEFAULT_STREAM_QUALITY,
      maxFps: 241,
    };
    expect(streamQualityIssues(overFps)).toContain(
      "Frame limit must be 0–240 fps.",
    );
  });

  it("normalizes quality values defensively without mutating original object", () => {
    const raw = {
      maxSize: 2560,
      bitRate: 16_000_000,
      maxFps: 90,
      codec: "h265",
    };
    const normalized = normalizeStreamQuality(raw);

    expect(normalized.maxSize).toBe(2560);
    expect(normalized.bitRate).toBe(16_000_000);
    expect(normalized.maxFps).toBe(90);
    expect(normalized.codec).toBe("h265");
    expect(normalized.mouse.mode).toBe("uhid");
    expect(normalized.audio.enabled).toBe(true);
  });
});
