"use client";

import { memo } from "react";
import type { GameMapping, GameProfile } from "../profiles/schema";
import type { ControlMode } from "../input/controlMode";
import { MappingInspector } from "./MappingInspector";
import { IconMappingType } from "./icons/UiIcons";

const ADD_TYPES: Array<{
  type: GameMapping["type"];
  label: string;
}> = [
  { type: "tap", label: "Tap" },
  { type: "hold", label: "Hold" },
  { type: "repeat", label: "Repeat" },
  { type: "swipe", label: "Swipe" },
  { type: "joystick", label: "Joystick" },
  { type: "mouse-button", label: "Mouse" },
  { type: "mouse-look", label: "Mouse-look" },
];

export interface MappingPanelProps {
  profile?: GameProfile;
  selectedId?: string;
  mode: ControlMode;
  onModeChange(value: ControlMode): void;
  onSelect(id?: string): void;
  onAdd(type: GameMapping["type"]): void;
  onChange(mapping: GameMapping): void;
  onDelete(id: string): void;
}

export const MappingPanel = memo(function MappingPanel({
  profile,
  selectedId,
  mode,
  onModeChange,
  onSelect,
  onAdd,
  onChange,
  onDelete,
}: MappingPanelProps) {
  const selected = profile?.mappings.find((mapping) => mapping.id === selectedId);
  return (
    <div className="panel-stack">
      <section className="panel-section">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Visual editor</span>
            <h3>Key mappings</h3>
          </div>
          <span className="count-badge">{profile?.mappings.length ?? 0}</span>
        </div>
        <div className="active-profile-card">
          <span>Active profile</span>
          <strong>{profile?.name ?? "No profile loaded"}</strong>
          <small>{profile?.mappings.length ?? 0} saved controls</small>
        </div>
        <div className="mode-toggle" role="group" aria-label="Mapping editor mode">
          <button
            type="button"
            className={mode === "edit" ? "active" : ""}
            onClick={() => onModeChange("edit")}
          >
            Edit
          </button>
          <button
            type="button"
            className={mode === "play" ? "active" : ""}
            onClick={() => onModeChange("play")}
          >
            Play
          </button>
        </div>
        <p className="mode-description">
          {mode === "edit"
            ? "Place and configure controls. Direct Android input is paused while editing."
            : "Mapped keys activate controls. Unmapped keys and uncaptured mouse input continue to Android."}
        </p>

        <span className="eyebrow" style={{ marginTop: "8px" }}>Add control layer</span>
        <div className="mapping-type-grid">
          {ADD_TYPES.map((item) => (
            <button
              type="button"
              key={item.type}
              onClick={() => onAdd(item.type)}
              disabled={!profile || mode !== "edit"}
            >
              <IconMappingType type={item.type} size={20} />
              {item.label}
            </button>
          ))}
        </div>
      </section>

      {profile && profile.mappings.length > 0 ? (
        <section className="panel-section mapping-list-section">
          <span className="eyebrow">Configured layers</span>
          <div className="mapping-list">
            {profile.mappings.map((mapping) => (
              <button
                type="button"
                key={mapping.id}
                className={selectedId === mapping.id ? "active" : ""}
                onClick={() => onSelect(selectedId === mapping.id ? undefined : mapping.id)}
              >
                <span className={`mini-dot ${mapping.enabled ? "ok" : ""}`} />
                <IconMappingType type={mapping.type} size={16} />
                <span>
                  {mapping.name}
                  <small style={{ display: "block", opacity: 0.65 }}>{mapping.type.replace("-", " ")}</small>
                </span>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {mode === "edit" ? (
        <section className="panel-section">
          <MappingInspector
            mapping={selected}
            onChange={onChange}
            onDelete={onDelete}
          />
        </section>
      ) : (
        <section className="panel-section play-callout" style={{ background: "var(--accent-subtle)", borderColor: "var(--accent-border)" }}>
          <strong style={{ color: "var(--accent)" }}>Play mode active</strong>
          <p className="mode-description">
            Use the device normally. Only configured keys, mouse buttons, or
            mouse-look controls are captured by this profile.
          </p>
        </section>
      )}
    </div>
  );
});
