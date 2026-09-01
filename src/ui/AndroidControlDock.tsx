"use client";

import { memo, type ReactNode } from "react";
import {
  IconBack,
  IconHome,
  IconRecents,
  IconRotate,
  IconVolumeDown,
  IconVolumeUp,
  IconPower,
  IconText,
  IconPaste,
  IconCopy,
  IconFullscreen,
} from "./icons/UiIcons";

interface ControlButtonProps {
  label: string;
  icon: ReactNode;
  disabled?: boolean;
  onClick(): void;
}

function ControlButton({
  label,
  icon,
  disabled,
  onClick,
}: ControlButtonProps) {
  return (
    <button
      type="button"
      className="dock-button"
      disabled={disabled}
      onClick={onClick}
      aria-label={label}
      title={label}
    >
      <span aria-hidden="true">{icon}</span>
      <small>{label}</small>
    </button>
  );
}

export interface AndroidControlDockProps {
  streaming: boolean;
  fullscreenSupported: boolean;
  clipboardReadSupported: boolean;
  clipboardWriteSupported: boolean;
  onBack(): void;
  onHome(): void;
  onRecents(): void;
  onRotate(): void;
  onVolumeDown(): void;
  onVolumeUp(): void;
  onPower(): void;
  onText(): void;
  onPaste(): void;
  onCopy(): void;
  onFullscreen(): void;
}

export const AndroidControlDock = memo(function AndroidControlDock({
  streaming,
  fullscreenSupported,
  clipboardReadSupported,
  clipboardWriteSupported,
  onBack,
  onHome,
  onRecents,
  onRotate,
  onVolumeDown,
  onVolumeUp,
  onPower,
  onText,
  onPaste,
  onCopy,
  onFullscreen,
}: AndroidControlDockProps) {
  return (
    <nav className="control-dock" aria-label="Android controls">
      <ControlButton
        label="Back"
        icon={<IconBack size={18} />}
        disabled={!streaming}
        onClick={onBack}
      />
      <ControlButton
        label="Home"
        icon={<IconHome size={18} />}
        disabled={!streaming}
        onClick={onHome}
      />
      <ControlButton
        label="Recents"
        icon={<IconRecents size={18} />}
        disabled={!streaming}
        onClick={onRecents}
      />
      <span className="dock-divider" aria-hidden="true" />
      <ControlButton
        label="Rotate"
        icon={<IconRotate size={18} />}
        disabled={!streaming}
        onClick={onRotate}
      />
      <ControlButton
        label="Vol −"
        icon={<IconVolumeDown size={18} />}
        disabled={!streaming}
        onClick={onVolumeDown}
      />
      <ControlButton
        label="Vol +"
        icon={<IconVolumeUp size={18} />}
        disabled={!streaming}
        onClick={onVolumeUp}
      />
      <ControlButton
        label="Power"
        icon={<IconPower size={18} />}
        disabled={!streaming}
        onClick={onPower}
      />
      <span className="dock-divider" aria-hidden="true" />
      <ControlButton
        label="Text"
        icon={<IconText size={18} />}
        disabled={!streaming}
        onClick={onText}
      />
      <ControlButton
        label="Paste"
        icon={<IconPaste size={18} />}
        disabled={!streaming || !clipboardReadSupported}
        onClick={onPaste}
      />
      <ControlButton
        label="Copy"
        icon={<IconCopy size={18} />}
        disabled={!streaming || !clipboardWriteSupported}
        onClick={onCopy}
      />
      <ControlButton
        label="Fullscreen"
        icon={<IconFullscreen size={18} />}
        disabled={!fullscreenSupported}
        onClick={onFullscreen}
      />
    </nav>
  );
});
