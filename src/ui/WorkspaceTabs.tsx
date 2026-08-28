"use client";

import type { ReactNode } from "react";
import {
  IconLayers,
  IconSliders,
  IconGamepad,
  IconAlert,
} from "./icons/UiIcons";

export type WorkspacePanelId =
  | "mappings"
  | "stream"
  | "profiles"
  | "diagnostics";

interface TabButtonProps {
  id: string;
  active: boolean;
  label: string;
  icon: ReactNode;
  badge?: ReactNode;
  onClick(): void;
}

function TabButton({
  id,
  active,
  label,
  icon,
  badge,
  onClick,
}: TabButtonProps) {
  return (
    <button
      type="button"
      role="tab"
      id={`tab-${id}`}
      aria-selected={active}
      aria-controls={`panel-${id}`}
      className={active ? "active" : ""}
      onClick={onClick}
    >
      <span className="tab-icon" aria-hidden="true">{icon}</span>
      <span className="tab-label">{label}</span>
      {badge}
    </button>
  );
}

export interface WorkspaceTabsProps {
  active: WorkspacePanelId;
  mappingCount: number;
  hasErrors: boolean;
  onChange(panel: WorkspacePanelId): void;
}

export function WorkspaceTabs({
  active,
  mappingCount,
  hasErrors,
  onChange,
}: WorkspaceTabsProps) {
  return (
    <nav className="panel-tabs" role="tablist" aria-label="Workspace panels">
      <TabButton
        id="mappings"
        active={active === "mappings"}
        label="Mappings"
        icon={<IconLayers size={16} />}
        badge={<span className="tab-count">{mappingCount}</span>}
        onClick={() => onChange("mappings")}
      />
      <TabButton
        id="stream"
        active={active === "stream"}
        label="Stream"
        icon={<IconSliders size={16} />}
        onClick={() => onChange("stream")}
      />
      <TabButton
        id="profiles"
        active={active === "profiles"}
        label="Profiles"
        icon={<IconGamepad size={16} />}
        onClick={() => onChange("profiles")}
      />
      <TabButton
        id="diagnostics"
        active={active === "diagnostics"}
        label="Debug"
        icon={<IconAlert size={16} />}
        badge={hasErrors ? <span className="error-indicator" aria-label="Errors present" /> : null}
        onClick={() => onChange("diagnostics")}
      />
    </nav>
  );
}
