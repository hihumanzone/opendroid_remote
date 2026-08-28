import { describe, expect, it } from "vitest";

import {
  hasActiveMouseLook,
  mappedKeyboardCodes,
  routeKeyboardInput,
} from "../src/input/controlMode";
import {
  createMapping,
  createProfile,
  isGameMapping,
  isGameProfile,
  parseProfileJson,
  serializeProfile,
  type MouseLookMapping,
} from "../src/profiles/schema";

describe("Mapping UX & Control Enhancements", () => {
  describe("1. Numeric input & radius editing behaviors", () => {
    it("creates a joystick mapping with valid default radius and configurable range", () => {
      const joystick = createMapping("joystick");
      expect(joystick.type).toBe("joystick");
      expect(joystick.radius).toBe(0.09);
      expect(joystick.radius).toBeGreaterThan(0);
      expect(joystick.radius).toBeLessThanOrEqual(1);

      // Verify custom typed values in valid range are accepted
      joystick.radius = 0.25;
      expect(isGameMapping(joystick)).toBe(true);

      // Verify boundary values
      joystick.radius = 0.01;
      expect(isGameMapping(joystick)).toBe(true);
      joystick.radius = 0.5;
      expect(isGameMapping(joystick)).toBe(true);
    });

    it("clamps numbers properly within range without dropping precision", () => {
      const clampHelper = (raw: string, fallback: number, min: number, max: number) => {
        let next = Number(raw);
        if (!Number.isFinite(next) || raw.trim() === "") {
          next = fallback;
        }
        const clamped = Math.min(max, Math.max(min, next));
        return Number(clamped.toFixed(4));
      };

      expect(clampHelper("0.25", 0.09, 0.01, 0.5)).toBe(0.25);
      expect(clampHelper("0.001", 0.09, 0.01, 0.5)).toBe(0.01);
      expect(clampHelper("0.99", 0.09, 0.01, 0.5)).toBe(0.5);
      expect(clampHelper("", 0.09, 0.01, 0.5)).toBe(0.09);
      expect(clampHelper("abc", 0.09, 0.01, 0.5)).toBe(0.09);
    });
  });

  describe("2. Camera lock toggle trigger and defaults", () => {
    it("creates mouse-look mapping with default toggle trigger", () => {
      const look = createMapping("mouse-look");
      expect(look.type).toBe("mouse-look");
      expect(look.toggleTrigger).toEqual({ kind: "key", code: "KeyY" });
      expect(isGameMapping(look)).toBe(true);
    });

    it("registers camera lock toggle trigger key in mapped keyboard codes", () => {
      const profile = createProfile("Camera Lock Test");
      const look: MouseLookMapping = {
        ...createMapping("mouse-look"),
        toggleTrigger: { kind: "key", code: "KeyT" },
      };
      profile.mappings = [look];

      const mapped = mappedKeyboardCodes(profile, "landscape");
      expect(mapped.has("KeyT")).toBe(true);
      expect(mapped.has("Escape")).toBe(true); // emergencyCode default
    });

    it("routes unmapped keys to Android and camera lock triggers to mapping in play mode", () => {
      const profile = createProfile("Camera Lock Routing");
      const look = createMapping("mouse-look");
      profile.mappings = [look];
      const mapped = mappedKeyboardCodes(profile, "landscape");

      expect(routeKeyboardInput("play", "KeyY", mapped)).toBe("mapping");
      expect(routeKeyboardInput("play", "Escape", mapped)).toBe("mapping");
      expect(routeKeyboardInput("play", "KeyA", mapped)).toBe("android");
      expect(routeKeyboardInput("edit", "KeyY", mapped)).toBe("block-editor");
    });

    it("serializes and round-trips mouse-look mappings with custom toggle trigger", () => {
      const profile = createProfile("Shooter Profile");
      const look: MouseLookMapping = {
        ...createMapping("mouse-look"),
        toggleTrigger: { kind: "key", code: "Backquote" },
      };
      profile.mappings = [look];

      const json = serializeProfile(profile);
      const parsed = parseProfileJson(json);
      expect(isGameProfile(parsed)).toBe(true);
      const parsedLook = parsed.mappings[0] as MouseLookMapping;
      expect(parsedLook.toggleTrigger).toEqual({ kind: "key", code: "Backquote" });
    });

    it("supports backward-compatible mouse-look mappings with legacy enable/disable triggers or without explicit triggers", () => {
      const profile = createProfile("Legacy Profile");
      const look: MouseLookMapping = {
        ...createMapping("mouse-look"),
        enableTrigger: { kind: "key", code: "KeyT" },
        disableTrigger: { kind: "key", code: "KeyG" },
      };
      delete (look as Partial<MouseLookMapping>).toggleTrigger;
      profile.mappings = [look];

      const json = serializeProfile(profile);
      const parsed = parseProfileJson(json);
      expect(isGameProfile(parsed)).toBe(true);
      expect(hasActiveMouseLook(parsed, "landscape")).toBe(true);
      const mapped = mappedKeyboardCodes(parsed, "landscape");
      expect(mapped.has("KeyT")).toBe(true);
    });
  });

  describe("3. Mapping selection and deselection lifecycle", () => {
    it("toggles selection state properly", () => {
      const toggleSelect = (currentSelected: string | undefined, id: string) => {
        return currentSelected === id ? undefined : id;
      };

      expect(toggleSelect(undefined, "mapping-1")).toBe("mapping-1");
      expect(toggleSelect("mapping-1", "mapping-1")).toBe(undefined);
      expect(toggleSelect("mapping-1", "mapping-2")).toBe("mapping-2");
    });
  });
});