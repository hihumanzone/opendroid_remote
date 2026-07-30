"use client";

import type {
  MouseInputMode,
  SessionStats,
} from "../core/types";
import type { AudioPlaybackSnapshot } from "../scrcpy/ScrcpySession";
import { IconLayers, IconCpu } from "./icons/UiIcons";

export interface StageStatusBarProps {
  streaming: boolean;
  stats: SessionStats;
  audio: AudioPlaybackSnapshot;
  mouseMode: MouseInputMode;
  pointerLocked: boolean;
  overlaysVisible: boolean;
  onToggleOverlays(): void;
}

function audioLabel(audio: AudioPlaybackSnapshot): string {
  return audio.status === "playing"
    ? "Audio: Playing"
    : `Audio: ${audio.status}`;
}

function mouseLabel(
  mode: MouseInputMode,
  pointerLocked: boolean,
): string {
  if (mode === "uhid") {
    return pointerLocked
      ? "Mouse: UHID Captured"
      : "Mouse: UHID (Click)";
  }
  if (mode === "sdk") return "Mouse: SDK Absolute";
  return "Mouse: Off";
}

export function StageStatusBar({
  streaming,
  stats,
  audio,
  mouseMode,
  pointerLocked,
  overlaysVisible,
  onToggleOverlays,
}: StageStatusBarProps) {
  return (
    <div className="stage-status-bar">
      <div className="status-chips">
        <span className="chip active">
          <IconCpu size={14} />
          WebUSB ADB
        </span>
        <span className="chip">
          {streaming
            ? `${stats.width}×${stats.height} · ${stats.codec?.toUpperCase()}`
            : "Awaiting stream"}
        </span>
        <span className={`chip ${audio.status === "playing" ? "active" : ""}`}>
          {audioLabel(audio)}
        </span>
        <span className={`chip ${pointerLocked ? "active" : ""}`}>
          {mouseLabel(mouseMode, pointerLocked)}
        </span>
      </div>

      <button
        type="button"
        className={`button subtle ${overlaysVisible ? "game-button active" : ""}`}
        onClick={onToggleOverlays}
        aria-pressed={overlaysVisible}
      >
        <IconLayers size={16} />
        Overlays {overlaysVisible ? "On" : "Off"}
      </button>
    </div>
  );
}
