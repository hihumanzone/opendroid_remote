import { describe, expect, it } from "vitest";

import {
  resolveDynamicDisplayUpdate,
  type AndroidCapabilities,
} from "../src/scrcpy/ScrcpySession";

function capabilities(): AndroidCapabilities {
  return {
    displays: [
      { id: 0, resolution: "1080x2400", focused: true },
      { id: 4, resolution: "1920x1080", focused: false },
    ],
    encoders: [],
    audioEncoders: [],
    browserCodecs: { h264: true, h265: false, av1: false },
    browserAudioCodecs: {
      raw: true,
      opus: false,
      aac: false,
      flac: false,
    },
    uhidMouse: { supported: true, reason: "test" },
    focusedDisplayId: 0,
    recommendedDisplayId: 0,
  };
}

describe("dynamic display transitions", () => {
  it("updates focus without requiring a disruptive inventory probe", () => {
    const current = capabilities();
    const update = resolveDynamicDisplayUpdate(current, 4);

    expect(update.focusedDisplayChanged).toBe(true);
    expect(update.inventoryRefreshRequired).toBe(false);
    expect(update.capabilities.focusedDisplayId).toBe(4);
    expect(update.capabilities.recommendedDisplayId).toBe(4);
    expect(
      update.capabilities.displays.find((display) => display.id === 4)?.focused,
    ).toBe(true);
    expect(current.focusedDisplayId).toBe(0);
  });

  it("requests serialized discovery only for an unknown focused display", () => {
    const current = capabilities();
    const update = resolveDynamicDisplayUpdate(current, 9);

    expect(update.focusedDisplayChanged).toBe(true);
    expect(update.inventoryRefreshRequired).toBe(true);
    expect(update.capabilities).toBe(current);
  });

  it("keeps the current inventory when focus cannot be detected", () => {
    const current = capabilities();
    const update = resolveDynamicDisplayUpdate(current, undefined);

    expect(update).toEqual({
      capabilities: current,
      focusedDisplayChanged: false,
      inventoryRefreshRequired: false,
    });
  });
});
