"use client";

import { memo, useMemo, useRef, useState } from "react";

import type { AutoProfileState } from "../profiles/AutoProfileCoordinator";
import type { GameProfile } from "../profiles/schema";
import type { ImportPreferences } from "../settings/AppSettings";
import { CustomSelect } from "./controls/CustomSelect";
import { SliderNumberField } from "./controls/SliderNumberField";
import {
  IconAlert,
  IconCheck,
  IconDownload,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconSmartphone,
  IconStar,
  IconTrash,
  IconUpload,
} from "./icons/UiIcons";

export interface ProfilePanelProps {
  profiles: readonly GameProfile[];
  active?: GameProfile;
  defaultProfileId?: string;
  onSetDefaultProfile(id: string): void;
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

  // Auto-switch & application detection integration
  autoProfileState: AutoProfileState;
  onToggleAutoSwitch(enabled: boolean): void;
  onClearManualOverride(): void;
  onDetectCurrentApp(): Promise<void>;
  onScanInstalledApps(): Promise<string[]>;
}

export const ProfilePanel = memo(function ProfilePanel({
  profiles,
  active,
  defaultProfileId,
  onSetDefaultProfile,
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
  autoProfileState,
  onToggleAutoSwitch,
  onClearManualOverride,
  onDetectCurrentApp,
  onScanInstalledApps,
}: ProfilePanelProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [detecting, setDetecting] = useState(false);
  const [scanningApps, setScanningApps] = useState(false);
  const [installedApps, setInstalledApps] = useState<string[] | null>(null);
  const [appPickerFilter, setAppPickerFilter] = useState("");

  const filteredProfiles = useMemo(() => {
    if (!searchQuery.trim()) return profiles;
    const q = searchQuery.toLowerCase().trim();
    return profiles.filter((p) => {
      const matchName = p.name.toLowerCase().includes(q);
      const matchTitle = p.game?.title?.toLowerCase().includes(q) ?? false;
      const matchPkg = p.game?.packageName?.toLowerCase().includes(q) ?? false;
      return matchName || matchTitle || matchPkg;
    });
  }, [profiles, searchQuery]);

  const handleDetectClick = async () => {
    setDetecting(true);
    try {
      await onDetectCurrentApp();
    } finally {
      setDetecting(false);
    }
  };

  const handleScanApps = async () => {
    if (installedApps !== null) {
      setInstalledApps(null);
      return;
    }
    setScanningApps(true);
    try {
      const list = await onScanInstalledApps();
      setInstalledApps(list);
    } finally {
      setScanningApps(false);
    }
  };

  const assignCurrentAppToActive = () => {
    if (!active || !autoProfileState.activePackage) return;
    const currentPkg = autoProfileState.activePackage;
    onChange({
      ...active,
      game: {
        ...active.game,
        packageName: currentPkg,
        title: active.game?.title || currentPkg.split(".").pop(),
      },
    });
  };

  const assignPickedAppToActive = (pkg: string) => {
    if (!active) return;
    onChange({
      ...active,
      game: {
        ...active.game,
        packageName: pkg,
        title: active.game?.title || pkg.split(".").pop(),
      },
    });
    setInstalledApps(null);
  };

  const filteredInstalledApps = useMemo(() => {
    if (!installedApps) return [];
    if (!appPickerFilter.trim()) return installedApps;
    const q = appPickerFilter.toLowerCase().trim();
    return installedApps.filter((pkg) => pkg.toLowerCase().includes(q));
  }, [appPickerFilter, installedApps]);

  const isDefaultActive = active?.id === defaultProfileId;

  return (
    <div className="panel-stack">
      {/* SECTION 1: Automatic Application Switching Command Banner */}
      <section className="panel-section">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Smart Mapping Profiles</span>
            <h3>Application Profiles</h3>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={onNew}
            aria-label="Create profile"
            title="Create new profile"
          >
            <IconPlus size={18} />
          </button>
        </div>

        <div
          className={`auto-switch-banner ${
            autoProfileState.status === "matched"
              ? "active-matched"
              : autoProfileState.status === "manual-override"
                ? "override"
                : ""
          }`}
        >
          <div className="auto-switch-header">
            <label className="switch inline" style={{ margin: 0 }}>
              <input
                type="checkbox"
                checked={autoProfileState.enabled}
                onChange={(e) => onToggleAutoSwitch(e.target.checked)}
              />
              <span style={{ fontWeight: 650 }}>Auto-switch profiles</span>
            </label>
            <button
              type="button"
              className="button subtle"
              style={{ padding: "4px 8px", fontSize: "11.5px" }}
              onClick={handleDetectClick}
              disabled={detecting}
              title="Query connected Android device for currently focused application"
            >
              <IconRefresh
                size={14}
                style={{
                  animation: detecting ? "spin 1s linear infinite" : "none",
                }}
              />
              {detecting ? "Detecting..." : "Detect app"}
            </button>
          </div>

          <div className="auto-switch-status-row">
            <span style={{ color: "var(--muted)" }}>Active on phone:</span>
            {autoProfileState.activePackage ? (
              <span className="detected-app-badge" title={autoProfileState.activePackage}>
                <IconSmartphone size={12} />
                {autoProfileState.activePackage}
                {autoProfileState.isLauncher ? " (Home)" : ""}
              </span>
            ) : (
              <span style={{ color: "var(--muted)", fontStyle: "italic" }}>
                {autoProfileState.status === "idle"
                  ? "Device not connected"
                  : "Checking device..."}
              </span>
            )}
          </div>

          {autoProfileState.status === "manual-override" ? (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "6px 8px",
                background: "rgba(245, 158, 11, 0.15)",
                borderRadius: "var(--radius-sm)",
                fontSize: "11.5px",
              }}
            >
              <span style={{ color: "var(--ink)", display: "flex", alignItems: "center", gap: "5px" }}>
                <IconAlert size={14} style={{ color: "#f59e0b" }} />
                Manual override active
              </span>
              <button
                type="button"
                className="button subtle"
                style={{ padding: "2px 8px", fontSize: "11px" }}
                onClick={onClearManualOverride}
              >
                Resume auto-switch
              </button>
            </div>
          ) : autoProfileState.status === "matched" ? (
            <div
              style={{
                fontSize: "11.5px",
                color: "var(--accent)",
                display: "flex",
                alignItems: "center",
                gap: "6px",
              }}
            >
              <span className="mini-dot ok" />
              <span>
                Auto-switched to <strong>{autoProfileState.matchedProfileName}</strong>
              </span>
            </div>
          ) : autoProfileState.status === "default-restored" ? (
            <div
              style={{
                fontSize: "11.5px",
                color: "var(--muted)",
                display: "flex",
                alignItems: "center",
                gap: "6px",
              }}
            >
              <span className="mini-dot" />
              <span>Default fallback profile restored</span>
            </div>
          ) : null}
        </div>
      </section>

      {/* SECTION 2: Profile Library with Live Search */}
      <section className="panel-section">
        <div className="section-heading" style={{ marginBottom: "6px" }}>
          <span className="eyebrow">Profiles Library</span>
          <span className="count-badge">{profiles.length}</span>
        </div>

        <div className="profile-search-container">
          <span className="profile-search-icon">
            <IconSearch size={15} />
          </span>
          <input
            type="search"
            className="profile-search-input"
            placeholder="Search profiles or package..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <div className="profile-cards-list">
          {filteredProfiles.length === 0 ? (
            <div style={{ textAlign: "center", padding: "16px", color: "var(--muted)", fontSize: "12px" }}>
              No profiles found matching “{searchQuery}”.
            </div>
          ) : (
            filteredProfiles.map((p) => {
              const isActive = p.id === active?.id;
              const isDefault = p.id === defaultProfileId;
              return (
                <div
                  key={p.id}
                  className={`profile-card-item ${isActive ? "active" : ""}`}
                  onClick={() => onSelect(p.id)}
                >
                  <div className="profile-card-top">
                    <span className="profile-card-title">
                      {p.name}
                      {isActive ? (
                        <span className="profile-tag highlight">Active</span>
                      ) : null}
                      {isDefault ? (
                        <span className="profile-tag" style={{ color: "#f59e0b" }}>
                          ★ Default
                        </span>
                      ) : null}
                    </span>
                    <span style={{ fontSize: "11px", color: "var(--muted)" }}>
                      {p.mappings.length} mapping{p.mappings.length === 1 ? "" : "s"}
                    </span>
                  </div>

                  <div className="profile-card-tags">
                    {p.game?.packageName ? (
                      <span className="profile-tag package" title={p.game.packageName}>
                        {p.game.packageName}
                      </span>
                    ) : (
                      <span className="profile-tag" style={{ opacity: 0.6 }}>
                        No app linked
                      </span>
                    )}
                    {p.game?.title ? (
                      <span className="profile-tag">{p.game.title}</span>
                    ) : null}
                    <span className="profile-tag">{p.reference.orientation}</span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </section>

      {/* SECTION 3: Active Profile Settings & App Assignment */}
      {active ? (
        <section className="panel-section">
          <div className="section-heading">
            <div>
              <span className="eyebrow">Profile Configuration</span>
              <h3 style={{ fontSize: "15px" }}>{active.name}</h3>
            </div>
            <button
              type="button"
              className="button subtle"
              style={{
                padding: "3px 8px",
                fontSize: "11.5px",
                color: isDefaultActive ? "#f59e0b" : "var(--muted)",
              }}
              onClick={() => onSetDefaultProfile(active.id)}
              title={
                isDefaultActive
                  ? "This is the default fallback profile"
                  : "Set this profile as default fallback for unmapped apps / home screen"
              }
            >
              <IconStar size={13} fill={isDefaultActive ? "#f59e0b" : "none"} />
              {isDefaultActive ? "Default Fallback" : "Make Default"}
            </button>
          </div>

          <label className="field">
            <span>Profile name</span>
            <input
              value={active.name}
              onChange={(e) =>
                onChange({
                  ...active,
                  name: e.target.value || "Untitled profile",
                })
              }
            />
          </label>

          <label className="field">
            <span>Game title</span>
            <input
              value={active.game?.title ?? ""}
              placeholder="e.g. Free Fire, Genshin Impact"
              onChange={(e) =>
                onChange({
                  ...active,
                  game: {
                    ...active.game,
                    title: e.target.value || undefined,
                  },
                })
              }
            />
          </label>

          <div className="field">
            <span>Android package name</span>
            <input
              value={active.game?.packageName ?? ""}
              placeholder="e.g. com.dts.freefireth (comma-separated or wildcard)"
              onChange={(e) =>
                onChange({
                  ...active,
                  game: {
                    ...active.game,
                    packageName: e.target.value || undefined,
                  },
                })
              }
            />
            <small style={{ color: "var(--muted)", fontSize: "11px", marginTop: "2px" }}>
              Supports comma-separated packages or wildcards (e.g. <code>com.pubg.*</code>).
            </small>

            <div style={{ display: "flex", gap: "6px", marginTop: "6px" }}>
              <button
                type="button"
                className="button subtle"
                style={{ fontSize: "11.5px", padding: "4px 8px", flex: 1 }}
                onClick={assignCurrentAppToActive}
                disabled={!autoProfileState.activePackage}
                title="Fill package name with currently open app on phone"
              >
                <IconSmartphone size={13} />
                Assign current app
              </button>
              <button
                type="button"
                className="button subtle"
                style={{ fontSize: "11.5px", padding: "4px 8px", flex: 1 }}
                onClick={handleScanApps}
                disabled={scanningApps}
                title="Scan and select an installed app from phone"
              >
                {scanningApps ? "Scanning..." : "Pick installed app"}
              </button>
            </div>

            {installedApps !== null ? (
              <div className="installed-apps-picker">
                <input
                  type="search"
                  placeholder="Filter installed apps..."
                  value={appPickerFilter}
                  onChange={(e) => setAppPickerFilter(e.target.value)}
                  style={{ fontSize: "11px", padding: "4px 8px" }}
                />
                {filteredInstalledApps.length === 0 ? (
                  <div style={{ padding: "8px", color: "var(--muted)", fontSize: "11px" }}>
                    No matching apps found on device.
                  </div>
                ) : (
                  filteredInstalledApps.slice(0, 50).map((pkg) => (
                    <button
                      key={pkg}
                      type="button"
                      className="installed-app-row"
                      onClick={() => assignPickedAppToActive(pkg)}
                    >
                      <span>{pkg}</span>
                      <IconCheck size={12} />
                    </button>
                  ))
                )}
              </div>
            ) : null}
          </div>

          <label className="field">
            <span>Emergency / pause key</span>
            <input
              value={active.settings.emergencyCode}
              onKeyDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onChange({
                  ...active,
                  settings: {
                    ...active.settings,
                    emergencyCode: e.code,
                  },
                });
              }}
              readOnly
              title="Focus and press any key to set as emergency pause"
            />
          </label>

          <SliderNumberField
            label="Overlay opacity"
            value={Math.round(active.settings.overlayOpacity * 100)}
            min={15}
            max={100}
            step={5}
            unit="%"
            precision={0}
            onChange={(val) =>
              onChange({
                ...active,
                settings: {
                  ...active.settings,
                  overlayOpacity: val / 100,
                },
              })
            }
          />

          <button
            type="button"
            className="button primary wide"
            onClick={onSave}
            disabled={!active}
          >
            <IconCheck size={18} />
            Save profile changes
          </button>

          <div className="button-row" style={{ marginTop: "8px" }}>
            <button type="button" className="button subtle" onClick={onDuplicate}>
              Duplicate
            </button>
            <button type="button" className="button subtle" onClick={onExport}>
              <IconDownload size={16} />
              Export JSON
            </button>
          </div>
          <div className="button-row">
            <button
              type="button"
              className="button subtle"
              onClick={() => inputRef.current?.click()}
            >
              <IconUpload size={16} />
              Import JSON
            </button>
            <button
              type="button"
              className="button danger subtle"
              onClick={onDelete}
            >
              <IconTrash size={16} />
              Delete profile
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
      ) : null}

      {/* SECTION 4: Saved Import Behavior */}
      <section className="panel-section">
        <span className="eyebrow">Saved Import Behavior</span>
        <h3 className="subsection-title">Import settings</h3>
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
    </div>
  );
});
