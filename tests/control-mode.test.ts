import { describe, expect, it } from "vitest";

import {
  hasActiveMouseLook,
  mappedKeyboardCodes,
  mappedMouseButtons,
  routeKeyboardInput,
  shouldCaptureMouseButton,
  shouldIgnoreMouseMovement,
  shouldInitiatePointerLock,
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
      ["F1", "KeyA", "KeyD", "KeyF", "KeyS"].sort(),
    );
  });

  it("does not hijack emergency key when profile has no active mappings", () => {
    const profile = createProfile();
    profile.mappings = [];
    expect([...mappedKeyboardCodes(profile, "landscape")]).toEqual([]);
    expect(routeKeyboardInput("play", "Escape", mappedKeyboardCodes(profile, "landscape"))).toBe("android");
  });

  describe("Physical UHID mouse capture routing", () => {
    it("ignores hover mouse movement when UHID mouse is not captured", () => {
      expect(shouldIgnoreMouseMovement("uhid", false)).toBe(true);
      expect(shouldIgnoreMouseMovement("uhid", true)).toBe(false);
      expect(shouldIgnoreMouseMovement("sdk", false)).toBe(false);
      expect(shouldIgnoreMouseMovement("touch", false)).toBe(false);
      expect(shouldIgnoreMouseMovement("disabled", false)).toBe(false);
    });

    it("initiates pointer lock without clicking Android when UHID mouse is uncaptured", () => {
      // Uncaptured UHID mouse clicking to capture
      expect(shouldInitiatePointerLock("uhid", false, false, false, 0)).toBe(true);
      expect(shouldInitiatePointerLock("uhid", false, false, false, 1)).toBe(true);
      expect(shouldInitiatePointerLock("uhid", false, false, false, 2)).toBe(true);

      // Captured UHID mouse clicks should register directly in Android
      expect(shouldInitiatePointerLock("uhid", true, false, false, 0)).toBe(false);
      expect(shouldInitiatePointerLock("uhid", true, false, false, 2)).toBe(false);

      // Other modes should not trigger capture on click
      expect(shouldInitiatePointerLock("sdk", false, false, false, 0)).toBe(false);
      expect(shouldInitiatePointerLock("touch", false, false, false, 0)).toBe(false);

      // Camera lock active with mouse-look initiates pointer lock on left click
      expect(shouldInitiatePointerLock("sdk", false, true, true, 0)).toBe(true);
      expect(shouldInitiatePointerLock("sdk", false, true, true, 2)).toBe(false);
      expect(shouldInitiatePointerLock("sdk", true, true, true, 0)).toBe(false);
    });
  });
});
