import type {
  GameMapping,
  GameProfile,
} from "../profiles/schema";

export type ControlMode = "edit" | "play";

export type KeyboardInputRoute =
  | "block-editor"
  | "mapping"
  | "android";

export function routeKeyboardInput(
  mode: ControlMode,
  code: string,
  mappedCodes: ReadonlySet<string>,
): KeyboardInputRoute {
  if (mode === "edit") return "block-editor";
  if (mappedCodes.has(code)) return "mapping";
  return "android";
}

function activeForOrientation(
  mapping: GameMapping,
  orientation: "portrait" | "landscape",
): boolean {
  return (
    mapping.enabled &&
    (mapping.orientation === "any" || mapping.orientation === orientation)
  );
}

export function mappedMouseButtons(
  profile: GameProfile | undefined,
  orientation: "portrait" | "landscape",
): ReadonlySet<number> {
  const buttons = new Set<number>();
  for (const mapping of profile?.mappings ?? []) {
    if (
      activeForOrientation(mapping, orientation) &&
      mapping.type === "mouse-button"
    ) {
      buttons.add(mapping.button);
    }
  }
  return buttons;
}

export function mappedKeyboardCodes(
  profile: GameProfile | undefined,
  orientation: "portrait" | "landscape",
): ReadonlySet<string> {
  const codes = new Set<string>();
  if (!profile) return codes;
  codes.add(profile.settings.emergencyCode);
  for (const mapping of profile.mappings) {
    if (!activeForOrientation(mapping, orientation)) continue;
    if (
      mapping.type === "tap" ||
      mapping.type === "hold" ||
      mapping.type === "repeat" ||
      mapping.type === "swipe"
    ) {
      codes.add(mapping.trigger.code);
    } else if (mapping.type === "joystick") {
      for (const code of Object.values(mapping.keys)) codes.add(code);
    }
  }
  return codes;
}

export function hasActiveMouseLook(
  profile: GameProfile | undefined,
  orientation: "portrait" | "landscape",
): boolean {
  return Boolean(
    profile?.mappings.some(
      (mapping) =>
        activeForOrientation(mapping, orientation) &&
        mapping.type === "mouse-look",
    ),
  );
}

export function shouldCaptureMouseButton(
  mode: ControlMode,
  button: number,
  buttons: ReadonlySet<number>,
): boolean {
  return mode === "play" && buttons.has(button);
}
