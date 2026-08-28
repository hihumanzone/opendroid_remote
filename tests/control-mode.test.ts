import { describe, expect, it } from "vitest";

import {
  hasActiveMouseLook,
  mappedKeyboardCodes,
  mappedMouseButtons,
  routeKeyboardInput,
  shouldCaptureMouseButton,
} from "../src/input/controlMode";
import {
  createMapping,
  createProfile,
} from "../src/profiles/schema";

describe("Edit and Play input routing", () => {
  it("blocks Android keyboard input in Edit mode", () => {
    expect(
      routeKeyboardInput("edit", "KeyW", new Set(["KeyW"])),
    ).toBe("block-editor");
  });

  it("runs mapped keys and passes unmapped keys to Android by default", () => {
    const profile = createProfile();
    const mapped = new Set(["KeyF", profile.settings.emergencyCode]);
    expect(routeKeyboardInput("play", "KeyF", mapped)).toBe("mapping");
    expect(routeKeyboardInput("play", "KeyT", mapped)).toBe("android");
  });

  it("ignores the legacy exclusive-input field and always passes unmapped keys", () => {
    const profile = createProfile();
    profile.settings.exclusiveInput = true;
    expect(routeKeyboardInput("play", "KeyT", new Set())).toBe("android");
  });

  it("captures only configured mouse buttons", () => {
    const profile = createProfile();
    const fire = createMapping("mouse-button");
    fire.button = 2;
    profile.mappings = [fire];
    const buttons = mappedMouseButtons(profile, "landscape");

    expect(shouldCaptureMouseButton("play", 2, buttons)).toBe(true);
    expect(shouldCaptureMouseButton("play", 0, buttons)).toBe(false);
    expect(shouldCaptureMouseButton("edit", 2, buttons)).toBe(false);
  });

  it("does not capture mappings disabled by the current orientation", () => {
    const profile = createProfile();
    const fire = createMapping("mouse-button");
    fire.button = 0;
    fire.orientation = "portrait";
    const look = createMapping("mouse-look");
    look.orientation = "portrait";
    profile.mappings = [fire, look];

    expect(mappedMouseButtons(profile, "landscape").has(0)).toBe(false);
    expect(hasActiveMouseLook(profile, "landscape")).toBe(false);
    expect(mappedMouseButtons(profile, "portrait").has(0)).toBe(true);
    expect(hasActiveMouseLook(profile, "portrait")).toBe(true);
  });

  it("collects active mapping keys and the emergency key once", () => {
    const profile = createProfile();
    const tap = createMapping("tap");
    tap.trigger.code = "KeyF";
    const portrait = createMapping("hold");
    portrait.trigger.code = "KeyP";
    portrait.orientation = "portrait";
    const joystick = createMapping("joystick");
    joystick.keys.up = "KeyF";
    profile.mappings = [tap, portrait, joystick];

    expect([...mappedKeyboardCodes(profile, "landscape")].sort()).toEqual(
      ["Escape", "KeyA", "KeyD", "KeyF", "KeyS"].sort(),
    );
  });

  it("does not hijack emergency key when profile has no active mappings", () => {
    const profile = createProfile();
    profile.mappings = [];
    expect([...mappedKeyboardCodes(profile, "landscape")]).toEqual([]);
    expect(routeKeyboardInput("play", "Escape", mappedKeyboardCodes(profile, "landscape"))).toBe("android");
  });
});
