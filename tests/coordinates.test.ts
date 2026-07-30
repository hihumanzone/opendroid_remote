import { describe, expect, it } from "vitest";

import {
  CoordinateTransform,
  clientToNormalized,
  clientToNormalizedContained,
  containedRect,
  normalizedToClient,
  normalizedToVideo,
  normalizedVisibleToSource,
  orientationOf,
  rotateNormalized,
} from "../src/coordinates/CoordinateTransform";

describe("coordinate transforms", () => {
  it("letterboxes portrait content in a landscape container", () => {
    expect(
      containedRect(
        { left: 10, top: 20, width: 1000, height: 500 },
        { width: 1080, height: 2400 },
      ),
    ).toEqual({
      left: 397.5,
      top: 20,
      width: 225,
      height: 500,
    });
  });

  it("pillarboxes ultrawide content without assuming aspect ratio", () => {
    const rect = containedRect(
      { left: 0, top: 0, width: 800, height: 800 },
      { width: 2400, height: 1080 },
    );
    expect(rect.width).toBe(800);
    expect(rect.height).toBe(360);
    expect(rect.top).toBe(220);
  });

  it("round-trips client and normalized positions", () => {
    const rect = { left: 40, top: 80, width: 700, height: 350 };
    const point = { x: 0.237, y: 0.814 };
    const client = normalizedToClient(point, rect);
    const normalized = clientToNormalized(client, rect)!;
    expect(normalized.x).toBeCloseTo(point.x);
    expect(normalized.y).toBeCloseTo(point.y);
  });

  it("maps against the contained video pixels when the CSS box has a different aspect ratio", () => {
    const surface = { left: 80, top: 40, width: 900, height: 500 };
    const video = { width: 1080, height: 2400 };
    const visible = containedRect(surface, video);

    for (const point of [
      { x: 0.03, y: 0.08 },
      { x: 0.5, y: 0.5 },
      { x: 0.97, y: 0.92 },
    ]) {
      const client = normalizedToClient(point, visible);
      const mapped = clientToNormalizedContained(
        client,
        surface,
        video,
      )!;
      expect(mapped.x).toBeCloseTo(point.x, 10);
      expect(mapped.y).toBeCloseTo(point.y, 10);
    }
  });

  it("rejects letterbox input unless clamping is requested", () => {
    const rect = { left: 100, top: 50, width: 200, height: 400 };
    expect(clientToNormalized({ x: 50, y: 200 }, rect)).toBeUndefined();
    expect(
      clientToNormalized({ x: 50, y: 500 }, rect, true),
    ).toEqual({ x: 0, y: 1 });
  });

  it("maps normalized endpoints to valid video pixels", () => {
    expect(normalizedToVideo({ x: 0, y: 0 }, { width: 2560, height: 1440 })).toEqual({
      x: 0,
      y: 0,
    });
    expect(normalizedToVideo({ x: 1, y: 1 }, { width: 2560, height: 1440 })).toEqual({
      x: 2559,
      y: 1439,
    });
  });

  it("maps cropped video coordinates back into the source display", () => {
    expect(
      normalizedVisibleToSource(
        { x: 0, y: 0 },
        { width: 2400, height: 1080 },
        { x: 200, y: 100, width: 1600, height: 800 },
      ),
    ).toEqual({ x: 200, y: 100 });
    expect(
      normalizedVisibleToSource(
        { x: 1, y: 1 },
        { width: 2400, height: 1080 },
        { x: 200, y: 100, width: 1600, height: 800 },
      ),
    ).toEqual({ x: 1799, y: 899 });
  });

  it.each([
    [0, { x: 0.2, y: 0.7 }],
    [90, { x: 0.3, y: 0.2 }],
    [180, { x: 0.8, y: 0.3 }],
    [270, { x: 0.7, y: 0.8 }],
  ] as const)("handles %s-degree orientation", (rotation, expected) => {
    const result = rotateNormalized({ x: 0.2, y: 0.7 }, rotation);
    expect(result.x).toBeCloseTo(expected.x);
    expect(result.y).toBeCloseTo(expected.y);
  });

  it("updates transforms across resize and rotation", () => {
    const transform = new CoordinateTransform(
      { left: 0, top: 0, width: 1200, height: 600 },
      { width: 2400, height: 1080 },
    );
    expect(transform.clientToVideo({ x: 600, y: 300 })).toEqual({
      x: 1200,
      y: 540,
    });
    transform.update(
      { left: 20, top: 10, width: 600, height: 1200 },
      { width: 1080, height: 2400 },
      90,
    );
    expect(transform.clientToNormalized({ x: 320, y: 610 })).toEqual({
      x: 0.5,
      y: 0.5,
    });
  });

  it("detects orientation independently of absolute dimensions", () => {
    expect(orientationOf({ width: 720, height: 1280 })).toBe("portrait");
    expect(orientationOf({ width: 3440, height: 1440 })).toBe("landscape");
    expect(orientationOf({ width: 800, height: 800 })).toBe("square");
  });
});
