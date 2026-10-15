"use client";

import { memo, useMemo, useState } from "react";
import type { AutoProfileState } from "../profiles/AutoProfileCoordinator";
import type { GameMapping, GameProfile } from "../profiles/schema";
import type { ControlMode } from "../input/controlMode";
import { MappingInspector } from "./MappingInspector";
import { IconMappingType, IconSmartphone } from "./icons/UiIcons";

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

type CategoryFilter = "all" | "movement" | "action" | "mouse";

function getMappingCategory(type: GameMapping["type"]): CategoryFilter {
  switch (type) {
    case "joystick":
      return "movement";
    case "tap":
    case "hold":
    case "repeat":
    case "swipe":
      return "action";
    case "mouse-button":
    case "mouse-look":
      return "mouse";
  }
}

function getTriggerLabel(mapping: GameMapping): string | undefined {
  switch (mapping.type) {
    case "tap":
    case "hold":
    case "repeat":
    case "swipe":
      return mapping.trigger.code.replace(/^Key|^Digit/, "");
    case "joystick":
      return "WASD";
    case "mouse-button":
      return `M${mapping.button + 1}`;
    case "mouse-look":
      return mapping.toggleTrigger?.code.replace(/^Key|^Digit/, "") ?? "Look";
  }
}

export interface MappingPanelProps {
  profile?: GameProfile;
  selectedId?: string;
  mode: ControlMode;
  autoProfileState?: AutoProfileState;
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
  autoProfileState,
  onModeChange,
  onSelect,
  onAdd,
  onChange,
  onDelete,
}: MappingPanelProps) {
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");
  const selected = profile?.mappings.find((mapping) => mapping.id === selectedId);

  const categoryCounts = useMemo(() => {
    const counts: Record<CategoryFilter, number> = {
      all: profile?.mappings.length ?? 0,
      movement: 0,
      action: 0,
      mouse: 0,
    };
    if (profile?.mappings) {
      for (const m of profile.mappings) {
        counts[getMappingCategory(m.type)] += 1;
      }
    }
    return counts;
  }, [profile?.mappings]);

  const filteredMappings = useMemo(() => {
    if (!profile?.mappings) return [];
    if (categoryFilter === "all") return profile.mappings;
    return profile.mappings.filter(
      (m) => getMappingCategory(m.type) === categoryFilter,
    );
  }, [profile?.mappings, categoryFilter]);

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
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: "2px" }}>
            <small>{profile?.mappings.length ?? 0} saved controls</small>
            {profile?.game?.packageName ? (
              <span
                style={{
                  fontSize: "10.5px",
                  fontFamily: "var(--font-mono, monospace)",
                  color: "var(--muted)",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "4px",
                }}
                title={`Linked App: ${profile.game.packageName}`}
              >
                <IconSmartphone size={11} />
                {profile.game.packageName.split(".").pop()}
              </span>
            ) : null}
          </div>
          {autoProfileState?.status === "matched" &&
          autoProfileState.matchedProfileId === profile?.id ? (
            <small style={{ color: "var(--accent)", fontSize: "11px", marginTop: "2px" }}>
              ● Auto-activated for {autoProfileState.activePackage}
            </small>
          ) : null}
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
          <div className="section-heading" style={{ marginBottom: "6px" }}>
            <span className="eyebrow">Configured layers</span>
            <span style={{ fontSize: "11px", color: "var(--muted)" }}>
              {filteredMappings.length} of {profile.mappings.length}
            </span>
          </div>

          <div className="mapping-category-filter">
            <button
              type="button"
              className={categoryFilter === "all" ? "active" : ""}
              onClick={() => setCategoryFilter("all")}
            >
              All ({categoryCounts.all})
            </button>
            <button
              type="button"
              className={categoryFilter === "movement" ? "active" : ""}
              onClick={() => setCategoryFilter("movement")}
            >
              Movement ({categoryCounts.movement})
            </button>
            <button
              type="button"
              className={categoryFilter === "action" ? "active" : ""}
              onClick={() => setCategoryFilter("action")}
            >
              Actions ({categoryCounts.action})
            </button>
            <button
              type="button"
              className={categoryFilter === "mouse" ? "active" : ""}
              onClick={() => setCategoryFilter("mouse")}
            >
              Mouse ({categoryCounts.mouse})
            </button>
          </div>

          {filteredMappings.length > 0 ? (
            <div className="mapping-list">
              {filteredMappings.map((mapping) => {
                const trigger = getTriggerLabel(mapping);
                return (
                  <button
                    type="button"
                    key={mapping.id}
                    className={selectedId === mapping.id ? "active" : ""}
                    onClick={() => onSelect(selectedId === mapping.id ? undefined : mapping.id)}
                  >
                    <span className={`mini-dot ${mapping.enabled ? "ok" : ""}`} />
                    <IconMappingType type={mapping.type} size={16} />
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {mapping.name}
                      <small style={{ display: "block", opacity: 0.65 }}>{mapping.type.replace("-", " ")}</small>
                    </span>
                    {trigger ? <span className="mapping-key-pill">{trigger}</span> : null}
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="empty-panel compact" style={{ padding: "16px 12px", textAlign: "center" }}>
              <p style={{ color: "var(--muted)", fontSize: "12px" }}>
                No {categoryFilter} layers in this profile.
              </p>
            </div>
          )}
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
