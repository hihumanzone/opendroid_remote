import { clamp } from "../core/types";

export interface JoystickKeys {
  up: string;
  down: string;
  left: string;
  right: string;
}

export interface JoystickVector {
  x: number;
  y: number;
  magnitude: number;
}

export function joystickVector(
  pressed: ReadonlySet<string>,
  keys: JoystickKeys,
): JoystickVector {
  const rawX = Number(pressed.has(keys.right)) - Number(pressed.has(keys.left));
  const rawY = Number(pressed.has(keys.down)) - Number(pressed.has(keys.up));
  const rawMagnitude = Math.hypot(rawX, rawY);
  if (rawMagnitude === 0) return { x: 0, y: 0, magnitude: 0 };
  const scale = rawMagnitude > 1 ? 1 / rawMagnitude : 1;
  return {
    x: rawX * scale,
    y: rawY * scale,
    magnitude: 1,
  };
}

export function joystickPoint(
  center: { x: number; y: number },
  radius: number | { x: number; y: number },
  vector: JoystickVector,
): { x: number; y: number } {
  const radiusX = typeof radius === "number" ? radius : radius.x;
  const radiusY = typeof radius === "number" ? radius : radius.y;
  return {
    x: clamp(center.x + vector.x * radiusX),
    y: clamp(center.y + vector.y * radiusY),
  };
}

export function smoothVector(
  current: JoystickVector,
  target: JoystickVector,
  factor: number,
): JoystickVector {
  const t = clamp(factor);
  const x = current.x + (target.x - current.x) * t;
  const y = current.y + (target.y - current.y) * t;
  return { x, y, magnitude: Math.min(1, Math.hypot(x, y)) };
}
