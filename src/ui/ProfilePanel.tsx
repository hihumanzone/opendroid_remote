"use client";

import { useRef } from "react";

import type { GameProfile } from "../profiles/schema";
import type { ImportPreferences } from "../settings/AppSettings";
import { IconPlus, IconDownload, IconUpload, IconTrash, IconCheck } from "./icons/UiIcons";
import { CustomSelect } from "./controls/CustomSelect";
import { CustomSlider } from "./controls/CustomSlider";

export interface ProfilePanelProps {
  profiles: readonly GameProfile[];
  active?: GameProfile;
  onSelect(id: string): void;
  onChange(profile: GameProfile): void;
  onNew(): void;
  onDuplicate(): void;
  onDelete(): void;
  importPreferences: ImportPreferences;
  onImportPreferencesChange(preferences: ImportPreferences): void;
  onImport(files: readonly File[]): void;
  onExport(): void;
  onSave(): void;
}

export function ProfilePanel({
  profiles,
  active,
  onSelect,
  onChange,
  onNew,
  onDuplicate,
  onDelete,
  importPreferences,
  onImportPreferencesChange,
  onImport,
  onExport,
  onSave,
}: ProfilePanelProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="panel-stack">
      <section className="panel-section">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Saved control sets</span>
            <h3>Mapping profiles</h3>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={onNew}
            aria-label="Create profile"
            title="Create profile"
          >
            <IconPlus size={18} />
          </button>
        </div>

        <p className="profile-intro">
          Each profile stores its own key mappings and control preferences.
          Switching profiles replaces the active control set immediately.
        </p>

        {active ? (
          <div className="active-profile-card">
            <span>Active profile</span>
            <strong>{active.name}</strong>
            <small>{active.mappings.length} mappings · saved in this browser</small>
          </div>
        ) : null}

        <label className="field">
          <span>Switch mapping profile</span>
          <CustomSelect
            value={active?.id ?? ""}
            onChange={onSelect}
            placeholder="Select a profile..."
            options={profiles.map((p) => ({
              value: p.id,
              label: p.name,
              description: `${p.mappings.length} mapping${p.mappings.length === 1 ? "" : "s"}`,
            }))}
          />
        </label>

        {active ? (
          <>
            <label className="field">
              <span>Rename profile</span>
              <input
                value={active.name}
                onChange={(event) =>
                  onChange({
                    ...active,
                    name: event.target.value || "Untitled profile",
                  })
                }
              />
            </label>
            <label className="field">
              <span>Game title</span>
              <input
                value={active.game?.title ?? ""}
                placeholder="Optional"
                onChange={(event) =>
                  onChange({
                    ...active,
                    game: {
                      ...active.game,
                      title: event.target.value || undefined,
                    },
                  })
                }
              />
            </label>
            <label className="field">
              <span>Android package</span>
              <input
                value={active.game?.packageName ?? ""}
                placeholder="com.example.game"
                onChange={(event) =>
                  onChange({
                    ...active,
                    game: {
                      ...active.game,
                      packageName: event.target.value || undefined,
                    },
                  })
                }
              />
            </label>

            <label className="field">
              <span>Emergency / pause key</span>
              <input
                value={active.settings.emergencyCode}
                onKeyDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onChange({
                    ...active,
                    settings: {
                      ...active.settings,
                      emergencyCode: event.code,
                    },
                  });
                }}
                readOnly
                title="Focus and press a key"
              />
            </label>

            <div className="range-field">
              <span>
                Overlay opacity{" "}
                <output>{Math.round(active.settings.overlayOpacity * 100)}%</output>
              </span>
              <CustomSlider
                min={0.15}
                max={1}
                step={0.05}
                value={active.settings.overlayOpacity}
                onChange={(val) =>
                  onChange({
                    ...active,
                    settings: {
                      ...active.settings,
                      overlayOpacity: val,
                    },
                  })
                }
              />
            </div>
          </>
        ) : null}

        <button
          type="button"
          className="button primary wide"
          onClick={onSave}
          disabled={!active}
        >
          <IconCheck size={18} />
          Save current mappings
        </button>
        <div className="button-row" style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
          <button type="button" className="button subtle" style={{ flex: 1 }} onClick={onDuplicate}>
            Duplicate
          </button>
          <button type="button" className="button subtle" style={{ flex: 1 }} onClick={onExport}>
            <IconDownload size={16} />
            Export JSON
          </button>
        </div>
        <div className="button-row" style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
          <button
            type="button"
            className="button subtle"
            style={{ flex: 1 }}
            onClick={() => inputRef.current?.click()}
          >
            <IconUpload size={16} />
            Import JSON
          </button>
          <button type="button" className="button danger subtle" style={{ flex: 1 }} onClick={onDelete}>
            <IconTrash size={16} />
            Delete
          </button>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="application/json,.json"
          multiple
          hidden
          onChange={(event) => {
            const files = [...(event.target.files ?? [])];
            if (files.length > 0) onImport(files);
            event.currentTarget.value = "";
          }}
        />
      </section>

      <section className="panel-section">
        <span className="eyebrow">Saved import behavior</span>
        <h3 className="subsection-title">Import settings</h3>
        <p className="profile-intro">
          Import one or several schema-v1 JSON profiles. Files are validated
          locally before anything is saved.
        </p>
        <label className="field">
          <span>When a profile ID already exists</span>
          <CustomSelect
            value={importPreferences.conflictStrategy}
            onChange={(val) =>
              onImportPreferencesChange({
                ...importPreferences,
                conflictStrategy: val as ImportPreferences["conflictStrategy"],
              })
            }
            options={[
              { value: "copy", label: "Create a copy with new IDs" },
              { value: "replace", label: "Replace the existing profile" },
              { value: "skip", label: "Skip the duplicate" },
            ]}
          />
        </label>
        <label className="field">
          <span>Maximum file size</span>
          <CustomSelect
            value={importPreferences.maxFileSizeMb}
            onChange={(val) =>
              onImportPreferencesChange({
                ...importPreferences,
                maxFileSizeMb: Number(val),
              })
            }
            options={[1, 2, 5, 10, 25, 50].map((size) => ({
              value: size,
              label: `${size} MB per JSON file`,
            }))}
          />
        </label>
        <label className="switch inline">
          <input
            type="checkbox"
            checked={importPreferences.activateAfterImport}
            onChange={(event) =>
              onImportPreferencesChange({
                ...importPreferences,
                activateAfterImport: event.target.checked,
              })
            }
          />
          <span>Switch to the last successfully imported profile</span>
        </label>
        <label className="switch inline">
          <input
            type="checkbox"
            checked={importPreferences.errorStrategy === "continue"}
            onChange={(event) =>
              onImportPreferencesChange({
                ...importPreferences,
                errorStrategy: event.target.checked ? "continue" : "stop",
              })
            }
          />
          <span>Continue a batch after an invalid file</span>
        </label>
      </section>

      <section className="panel-section callout">
        <strong>Profiles are resolution-independent</strong>
        <p>
          Coordinates are normalized to the video surface, so profiles scale
          across stream resolutions and orientation changes. Exported files use
          the documented schema version 1.
        </p>
      </section>
    </div>
  );
}
