import { describe, expect, it } from "vitest";
import { AndroidKeyCode } from "@yume-chan/scrcpy";

import { KeyboardState } from "../src/input/KeyboardState";
import { PointerIdAllocator } from "../src/input/PointerIdAllocator";
import { domCodeToAndroid } from "../src/input/keyboardMapping";
import { capabilityChecks } from "../src/capabilities/browserCapabilities";
import {
  joystickPoint,
  joystickVector,
  smoothVector,
} from "../src/input/joystick";

describe("keyboard mapping", () => {
  it("maps Escape and Esc DOM codes to Android Back keycode", () => {
    expect(domCodeToAndroid("Escape")).toBe(AndroidKeyCode.AndroidBack);
    expect(domCodeToAndroid("Esc")).toBe(AndroidKeyCode.AndroidBack);
  });

  it("maps standard keys and meta aliases correctly", () => {
    expect(domCodeToAndroid("KeyA")).toBe(AndroidKeyCode.KeyA);
    expect(domCodeToAndroid("OSLeft")).toBe(AndroidKeyCode.MetaLeft);
    expect(domCodeToAndroid("OSRight")).toBe(AndroidKeyCode.MetaRight);
  });
});

describe("browser capability checks", () => {
  it("includes keyboardLock check in capability list", () => {
    const checks = capabilityChecks({
      secureContext: true,
      webUsb: true,
      webCodecs: true,
      webAudio: true,
      webGl: true,
      pointerEvents: true,
      pointerLock: true,
      fullscreen: true,
      keyboardLock: true,
      clipboardRead: true,
      clipboardWrite: true,
      indexedDb: true,
      cryptoSubtle: true,
    });
    const lockCheck = checks.find((c) => c.id === "keyboardLock");
    expect(lockCheck).toBeDefined();
    expect(lockCheck?.supported).toBe(true);
    expect(lockCheck?.required).toBe(false);
  });
});

describe("keyboard state", () => {
  it("distinguishes first press, repeat, release, and reset", () => {
    const state = new KeyboardState();
    expect(state.press("KeyW")).toBe(true);
    expect(state.press("KeyW")).toBe(false);
    expect(state.snapshot()).toEqual(new Set(["KeyW"]));
    expect(state.release("KeyW")).toBe(true);
    expect(state.release("KeyW")).toBe(false);
    state.press("KeyA");
    state.press("KeyD");
    expect(state.clear()).toEqual(["KeyA", "KeyD"]);
    expect(state.size).toBe(0);
  });
});

describe("pointer allocation", () => {
  it("allocates stable independent IDs and safely reuses released IDs", () => {
    const pointers = new PointerIdAllocator(10n, 12n);
    expect(pointers.allocate("one")).toBe(10n);
    expect(pointers.allocate("two")).toBe(11n);
    expect(pointers.allocate("one")).toBe(10n);
    expect(pointers.release("one")).toBe(10n);
    expect(pointers.allocate("three")).toBe(10n);
    expect(pointers.allocate("four")).toBe(12n);
    expect(() => pointers.allocate("five")).toThrow(/No synthetic pointer/);
  });

  it("releases every owner during an emergency reset", () => {
    const pointers = new PointerIdAllocator(1n, 2n);
    pointers.allocate("a");
    pointers.allocate("b");
    expect(pointers.releaseAll()).toEqual([
      { owner: "a", id: 1n },
      { owner: "b", id: 2n },
    ]);
    expect(pointers.size).toBe(0);
    expect(pointers.allocate("c")).toBe(1n);
  });
});

describe("joystick vectors", () => {
  const keys = {
    up: "KeyW",
    down: "KeyS",
    left: "KeyA",
    right: "KeyD",
  };

  it("normalizes diagonals so they do not exceed the configured radius", () => {
    const vector = joystickVector(new Set(["KeyW", "KeyD"]), keys);
    expect(vector.magnitude).toBe(1);
    expect(vector.x).toBeCloseTo(Math.SQRT1_2);
    expect(vector.y).toBeCloseTo(-Math.SQRT1_2);
    const point = joystickPoint({ x: 0.2, y: 0.8 }, 0.1, vector);
    expect(point.x).toBeCloseTo(0.2 + Math.SQRT1_2 * 0.1);
    expect(point.y).toBeCloseTo(0.8 - Math.SQRT1_2 * 0.1);
  });

  it("cancels opposing directions and supports aspect-correct radii", () => {
    expect(joystickVector(new Set(["KeyA", "KeyD"]), keys)).toEqual({
      x: 0,
      y: 0,
      magnitude: 0,
    });
    expect(
      joystickPoint(
        { x: 0.5, y: 0.5 },
        { x: 0.05, y: 0.1 },
        { x: 1, y: -1, magnitude: 1 },
      ),
    ).toEqual({ x: 0.55, y: 0.4 });
  });

  it("smooths vectors deterministically", () => {
    expect(
      smoothVector(
        { x: 0, y: 0, magnitude: 0 },
        { x: 1, y: 0, magnitude: 1 },
        0.25,
      ),
    ).toEqual({ x: 0.25, y: 0, magnitude: 0.25 });
  });
});
