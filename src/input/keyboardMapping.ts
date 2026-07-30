import {
  AndroidKeyCode,
  AndroidKeyEventMeta,
} from "@yume-chan/scrcpy";

const KEY_CODE_MAP = AndroidKeyCode as unknown as Record<string, number>;

const ALIASES: Record<string, number> = {
  OSLeft: AndroidKeyCode.MetaLeft,
  OSRight: AndroidKeyCode.MetaRight,
  Esc: AndroidKeyCode.Escape,
};

export function domCodeToAndroid(code: string): number | undefined {
  return KEY_CODE_MAP[code] ?? ALIASES[code];
}

export interface ModifierState {
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  getModifierState?(key: string): boolean;
}

export function androidMetaState(event: ModifierState): number {
  let result = AndroidKeyEventMeta.None;
  if (event.altKey) result |= AndroidKeyEventMeta.Alt;
  if (event.ctrlKey) result |= AndroidKeyEventMeta.Ctrl;
  if (event.metaKey) result |= AndroidKeyEventMeta.Meta;
  if (event.shiftKey) result |= AndroidKeyEventMeta.Shift;
  if (event.getModifierState?.("CapsLock")) result |= AndroidKeyEventMeta.CapsLock;
  if (event.getModifierState?.("NumLock")) result |= AndroidKeyEventMeta.NumLock;
  return result;
}

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}

export function isReservedBrowserShortcut(event: KeyboardEvent): boolean {
  if (!(event.ctrlKey || event.metaKey)) return false;
  return [
    "KeyL",
    "KeyR",
    "KeyT",
    "KeyW",
    "KeyN",
    "KeyP",
    "KeyS",
    "KeyO",
    "KeyF",
    "Equal",
    "Minus",
    "Digit0",
  ].includes(event.code);
}

