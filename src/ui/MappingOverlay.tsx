"use client";

import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";

import type { Size } from "../core/types";
import type { GameMapping, GameProfile } from "../profiles/schema";

export interface MappingOverlayProps {
  profile: GameProfile;
  selectedId?: string;
  editing: boolean;
  visible: boolean;
  surfaceSize: Size;
  onSelect(id: string): void;
  onMove(id: string, point: { x: number; y: number }): void;
  onMoveSwipeEnd(id: string, point: { x: number; y: number }): void;
}

function triggerLabel(mapping: GameMapping): string {
  switch (mapping.type) {
    case "tap":
    case "hold":
    case "repeat":
    case "swipe":
      return mapping.trigger.code.replace(/^Key/, "");
    case "joystick":
      return "WASD";
    case "mouse-button":
      return `M${mapping.button + 1}`;
    case "mouse-look":
      return "LOOK";
  }
}

function typeLabel(mapping: GameMapping): string {
  switch (mapping.type) {
    case "tap":
      return "Tap";
    case "hold":
      return "Hold";
    case "repeat":
      return "Repeat";
    case "swipe":
      return "Swipe";
    case "joystick":
      return "Stick";
    case "mouse-button":
      return "Mouse";
    case "mouse-look":
      return "Look";
  }
}

function pointFromEvent(
  event: ReactPointerEvent<HTMLElement>,
): { x: number; y: number } {
  const rect = event.currentTarget.getBoundingClientRect();
  return {
    x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
    y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
  };
}

function markerStyle(mapping: GameMapping): CSSProperties {
  return {
    left: `${mapping.position.x * 100}%`,
    top: `${mapping.position.y * 100}%`,
  };
}

function radiusPixels(mapping: GameMapping, size: Size): number | undefined {
  if (mapping.type !== "joystick" && mapping.type !== "mouse-look") {
    return undefined;
  }
  return mapping.radius * Math.min(size.width, size.height) * 2;
}

export function MappingOverlay({
  profile,
  selectedId,
  editing,
  visible,
  surfaceSize,
  onSelect,
  onMove,
  onMoveSwipeEnd,
}: MappingOverlayProps) {
  if (!visible) return null;

  const startDrag = (
    event: ReactPointerEvent<HTMLButtonElement>,
    mapping: GameMapping,
    endpoint = false,
  ) => {
    if (!editing) return;
    event.preventDefault();
    event.stopPropagation();
    const button = event.currentTarget;
    button.setPointerCapture(event.pointerId);
    onSelect(mapping.id);
    const move = (moveEvent: PointerEvent) => {
      const overlay = button.closest(".mapping-overlay");
      if (!(overlay instanceof HTMLElement)) return;
      const rect = overlay.getBoundingClientRect();
      const point = {
        x: Math.min(1, Math.max(0, (moveEvent.clientX - rect.left) / rect.width)),
        y: Math.min(1, Math.max(0, (moveEvent.clientY - rect.top) / rect.height)),
      };
      if (endpoint) onMoveSwipeEnd(mapping.id, point);
      else onMove(mapping.id, point);
    };
    const finish = () => {
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", finish, true);
      window.removeEventListener("pointercancel", finish, true);
    };
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", finish, true);
    window.addEventListener("pointercancel", finish, true);
  };

  return (
    <div
      className={`mapping-overlay ${editing ? "is-editing" : ""}`}
      style={{ opacity: profile.settings.overlayOpacity }}
      onPointerDown={(event) => {
        if (!editing || event.target !== event.currentTarget) return;
        event.preventDefault();
        void pointFromEvent(event);
      }}
    >
      {profile.mappings.map((mapping) => {
        const selected = selectedId === mapping.id;
        const diameter = radiusPixels(mapping, surfaceSize);
        const rangeStyle =
          diameter === undefined
            ? undefined
            : ({
                left: `${mapping.position.x * 100}%`,
                top: `${mapping.position.y * 100}%`,
                width: `${diameter}px`,
                height: `${diameter}px`,
              } satisfies CSSProperties);
        return (
          <div
            className={`mapping-item mapping-${mapping.type} ${
              selected ? "is-selected" : ""
            } ${mapping.enabled ? "" : "is-disabled"}`}
            key={mapping.id}
          >
            {rangeStyle ? (
              <div
                className="mapping-range"
                style={rangeStyle}
                aria-hidden="true"
              />
            ) : null}
            {mapping.type === "swipe" ? (
              <>
                <svg
                  className="mapping-line"
                  viewBox={`0 0 ${Math.max(1, surfaceSize.width)} ${Math.max(
                    1,
                    surfaceSize.height,
                  )}`}
                  preserveAspectRatio="none"
                  aria-hidden="true"
                >
                  <line
                    x1={mapping.position.x * surfaceSize.width}
                    y1={mapping.position.y * surfaceSize.height}
                    x2={mapping.end.x * surfaceSize.width}
                    y2={mapping.end.y * surfaceSize.height}
                  />
                </svg>
                <button
                  type="button"
                  className="mapping-endpoint"
                  style={{
                    left: `${mapping.end.x * 100}%`,
                    top: `${mapping.end.y * 100}%`,
                  }}
                  onPointerDown={(event) => startDrag(event, mapping, true)}
                  aria-label={`Move end of ${mapping.name}`}
                  tabIndex={editing ? 0 : -1}
                />
              </>
            ) : null}
            <button
              type="button"
              className="mapping-marker"
              style={markerStyle(mapping)}
              onClick={() => onSelect(mapping.id)}
              onPointerDown={(event) => startDrag(event, mapping)}
              aria-label={`${mapping.name}: ${triggerLabel(mapping)}`}
              tabIndex={editing ? 0 : -1}
            >
              <span className="mapping-trigger">{triggerLabel(mapping)}</span>
              <span className="mapping-type">{typeLabel(mapping)}</span>
            </button>
          </div>
        );
      })}
    </div>
  );
}

