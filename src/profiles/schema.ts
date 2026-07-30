import type { NormalizedPoint } from "../core/types";
import type { JoystickKeys } from "../input/joystick";

export const PROFILE_SCHEMA_VERSION = 1 as const;

export type ProfileOrientation = "any" | "portrait" | "landscape";

export interface KeyTrigger {
  kind: "key";
  code: string;
}

export interface MappingBase {
  id: string;
  name: string;
  enabled: boolean;
  position: NormalizedPoint;
  orientation: ProfileOrientation;
}

export interface TapMapping extends MappingBase {
  type: "tap";
  trigger: KeyTrigger;
  durationMs: number;
}

export interface HoldMapping extends MappingBase {
  type: "hold";
  trigger: KeyTrigger;
}

export interface RepeatMapping extends MappingBase {
  type: "repeat";
  trigger: KeyTrigger;
  intervalMs: number;
  pressMs: number;
}

export interface SwipeMapping extends MappingBase {
  type: "swipe";
  trigger: KeyTrigger;
  end: NormalizedPoint;
  durationMs: number;
  releaseOnComplete: boolean;
}

export interface JoystickMapping extends MappingBase {
  type: "joystick";
  keys: JoystickKeys;
  radius: number;
  smoothing: number;
}

export interface MouseButtonMapping extends MappingBase {
  type: "mouse-button";
  button: number;
  behavior: "tap" | "hold";
  durationMs: number;
}

export interface MouseLookMapping extends MappingBase {
  type: "mouse-look";
  sensitivity: number;
  radius: number;
  invertX: boolean;
  invertY: boolean;
}

export type GameMapping =
  | TapMapping
  | HoldMapping
  | RepeatMapping
  | SwipeMapping
  | JoystickMapping
  | MouseButtonMapping
  | MouseLookMapping;

export interface GameProfile {
  schemaVersion: typeof PROFILE_SCHEMA_VERSION;
  id: string;
  name: string;
  game?: {
    title?: string;
    packageName?: string;
  };
  createdAt: string;
  updatedAt: string;
  reference: {
    orientation: ProfileOrientation;
    width?: number;
    height?: number;
  };
  settings: {
    emergencyCode: string;
    /**
     * @deprecated Retained for schema-v1 import compatibility. Play mode
     * always forwards unmapped input to Android.
     */
    exclusiveInput: boolean;
    overlayOpacity: number;
    mouseSensitivity: number;
  };
  mappings: GameMapping[];
}

const MAPPING_TYPES = new Set<GameMapping["type"]>([
  "tap",
  "hold",
  "repeat",
  "swipe",
  "joystick",
  "mouse-button",
  "mouse-look",
]);

const ORIENTATIONS = new Set<ProfileOrientation>([
  "any",
  "portrait",
  "landscape",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isPositiveNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value > 0;
}

function isPoint(value: unknown): value is NormalizedPoint {
  return (
    isRecord(value) &&
    isFiniteNumber(value.x) &&
    isFiniteNumber(value.y) &&
    value.x >= 0 &&
    value.x <= 1 &&
    value.y >= 0 &&
    value.y <= 1
  );
}

function isKeyTrigger(value: unknown): value is KeyTrigger {
  return (
    isRecord(value) &&
    value.kind === "key" &&
    typeof value.code === "string" &&
    value.code.length > 0
  );
}

function isOrientation(value: unknown): value is ProfileOrientation {
  return typeof value === "string" && ORIENTATIONS.has(value as ProfileOrientation);
}

function isMappingBase(value: Record<string, unknown>): boolean {
  return (
    typeof value.id === "string" &&
    value.id.length > 0 &&
    typeof value.name === "string" &&
    value.name.length > 0 &&
    typeof value.enabled === "boolean" &&
    isPoint(value.position) &&
    isOrientation(value.orientation)
  );
}

export function isGameMapping(value: unknown): value is GameMapping {
  if (!isRecord(value) || !isMappingBase(value)) return false;
  if (
    typeof value.type !== "string" ||
    !MAPPING_TYPES.has(value.type as GameMapping["type"])
  ) {
    return false;
  }
  switch (value.type) {
    case "tap":
      return isKeyTrigger(value.trigger) && isPositiveNumber(value.durationMs);
    case "hold":
      return isKeyTrigger(value.trigger);
    case "repeat":
      return (
        isKeyTrigger(value.trigger) &&
        isPositiveNumber(value.intervalMs) &&
        isPositiveNumber(value.pressMs) &&
        value.pressMs <= value.intervalMs
      );
    case "swipe":
      return (
        isKeyTrigger(value.trigger) &&
        isPoint(value.end) &&
        isPositiveNumber(value.durationMs) &&
        typeof value.releaseOnComplete === "boolean"
      );
    case "joystick":
      const keys = value.keys as Record<string, unknown>;
      return (
        isRecord(value.keys) &&
        ["up", "down", "left", "right"].every(
          (key) => typeof keys[key] === "string" && keys[key] !== "",
        ) &&
        isPositiveNumber(value.radius) &&
        value.radius <= 1 &&
        isFiniteNumber(value.smoothing) &&
        value.smoothing >= 0 &&
        value.smoothing <= 1
      );
    case "mouse-button":
      return (
        Number.isInteger(value.button) &&
        (value.button as number) >= 0 &&
        (value.behavior === "tap" || value.behavior === "hold") &&
        isPositiveNumber(value.durationMs)
      );
    case "mouse-look":
      return (
        isPositiveNumber(value.sensitivity) &&
        isPositiveNumber(value.radius) &&
        value.radius <= 1 &&
        typeof value.invertX === "boolean" &&
        typeof value.invertY === "boolean"
      );
    default:
      return false;
  }
}

export function isGameProfile(value: unknown): value is GameProfile {
  if (!isRecord(value)) return false;
  if (
    value.schemaVersion !== PROFILE_SCHEMA_VERSION ||
    typeof value.id !== "string" ||
    value.id.length === 0 ||
    typeof value.name !== "string" ||
    value.name.length === 0 ||
    typeof value.createdAt !== "string" ||
    !Number.isFinite(Date.parse(value.createdAt)) ||
    typeof value.updatedAt !== "string" ||
    !Number.isFinite(Date.parse(value.updatedAt)) ||
    !isRecord(value.reference) ||
    !isOrientation(value.reference.orientation) ||
    !isRecord(value.settings) ||
    typeof value.settings.emergencyCode !== "string" ||
    value.settings.emergencyCode.length === 0 ||
    typeof value.settings.exclusiveInput !== "boolean" ||
    !isFiniteNumber(value.settings.overlayOpacity) ||
    value.settings.overlayOpacity < 0 ||
    value.settings.overlayOpacity > 1 ||
    !isPositiveNumber(value.settings.mouseSensitivity) ||
    !Array.isArray(value.mappings) ||
    !value.mappings.every(isGameMapping)
  ) {
    return false;
  }
  if (
    value.reference.width !== undefined &&
    !isPositiveNumber(value.reference.width)
  ) {
    return false;
  }
  if (
    value.reference.height !== undefined &&
    !isPositiveNumber(value.reference.height)
  ) {
    return false;
  }
  if (value.game !== undefined) {
    if (!isRecord(value.game)) return false;
    if (
      value.game.title !== undefined &&
      typeof value.game.title !== "string"
    ) {
      return false;
    }
    if (
      value.game.packageName !== undefined &&
      typeof value.game.packageName !== "string"
    ) {
      return false;
    }
  }
  return true;
}

export function parseProfileJson(json: string): GameProfile {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch (error) {
    throw new Error("Profile is not valid JSON", { cause: error });
  }
  if (!isGameProfile(value)) {
    throw new Error(
      `Profile does not match schema version ${PROFILE_SCHEMA_VERSION}`,
    );
  }
  return structuredClone(value);
}

export function serializeProfile(profile: GameProfile): string {
  if (!isGameProfile(profile)) {
    throw new Error("Refusing to serialize an invalid profile");
  }
  return `${JSON.stringify(profile, null, 2)}\n`;
}

export function createId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

export function createProfile(name = "New game profile"): GameProfile {
  const now = new Date().toISOString();
  return {
    schemaVersion: PROFILE_SCHEMA_VERSION,
    id: createId("profile"),
    name,
    createdAt: now,
    updatedAt: now,
    reference: { orientation: "any" },
    settings: {
      emergencyCode: "Escape",
      exclusiveInput: false,
      overlayOpacity: 0.88,
      mouseSensitivity: 0.0015,
    },
    mappings: [],
  };
}

export function createMapping<T extends GameMapping["type"]>(
  type: T,
  position?: NormalizedPoint,
): Extract<GameMapping, { type: T }>;
export function createMapping(
  type: GameMapping["type"],
  position: NormalizedPoint = { x: 0.5, y: 0.5 },
): GameMapping {
  const base: MappingBase = {
    id: createId("mapping"),
    name: type
      .split("-")
      .map((part) => part[0]!.toUpperCase() + part.slice(1))
      .join(" "),
    enabled: true,
    position,
    orientation: "any",
  };
  switch (type) {
    case "tap":
      return { ...base, type, trigger: { kind: "key", code: "KeyF" }, durationMs: 55 };
    case "hold":
      return { ...base, type, trigger: { kind: "key", code: "Space" } };
    case "repeat":
      return {
        ...base,
        type,
        trigger: { kind: "key", code: "KeyR" },
        intervalMs: 120,
        pressMs: 45,
      };
    case "swipe":
      return {
        ...base,
        type,
        trigger: { kind: "key", code: "KeyQ" },
        end: { x: Math.min(0.95, position.x + 0.2), y: position.y },
        durationMs: 260,
        releaseOnComplete: true,
      };
    case "joystick":
      return {
        ...base,
        type,
        name: "Movement",
        keys: { up: "KeyW", down: "KeyS", left: "KeyA", right: "KeyD" },
        radius: 0.09,
        smoothing: 0.35,
      };
    case "mouse-button":
      return {
        ...base,
        type,
        name: "Primary fire",
        button: 0,
        behavior: "hold",
        durationMs: 55,
      };
    case "mouse-look":
      return {
        ...base,
        type,
        name: "Camera look",
        sensitivity: 0.0015,
        radius: 0.2,
        invertX: false,
        invertY: false,
      };
  }
}
