import { describe, expect, it } from "vitest";

import { normalizeWheelDelta } from "../src/input/wheel";

describe("Android wheel normalization", () => {
  it("normalizes pixel, line, and page deltas for scrcpy", () => {
    expect(normalizeWheelDelta(0, 100, 0, 800)).toEqual({ x: -0, y: -1 });
    expect(normalizeWheelDelta(0, 3, 1, 800)).toEqual({
      x: -0,
      y: -0.96,
    });
    expect(normalizeWheelDelta(0, 1, 2, 800)).toEqual({ x: -0, y: -8 });
  });

  it("clamps extreme trackpad and wheel input", () => {
    expect(normalizeWheelDelta(-50_000, 50_000, 0, 800)).toEqual({
      x: 16,
      y: -16,
    });
  });
});
