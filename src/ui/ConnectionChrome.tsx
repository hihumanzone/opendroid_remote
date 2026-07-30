import type { AdbTransportSnapshot } from "../adb/WebUsbAdbTransport";
import {
  connectionPhaseLabel,
  pendingConnectionPresentation,
  pendingDeviceLabel,
} from "../adb/connectionPresentation";
import type { ControlMode } from "../input/controlMode";
import {
  IconUsb,
  IconGamepad,
  IconAlert,
  IconClose,
  IconRefresh,
} from "./icons/UiIcons";
import { CustomSelect } from "./controls/CustomSelect";

export interface ConnectionChromeProps {
  transport: AdbTransportSnapshot;
  browserReady: boolean;
  missingCapabilities: readonly string[];
  selectedDevice: string;
  activeSerial: string;
  streaming: boolean;
  busy: boolean;
  mode: ControlMode;
  onSelectDevice(serial: string): void;
  onReconnect(serial: string): void;
  onConnect(): void;
  onToggleMode(): void;
  onDisconnect(serial: string): void;
  onDisconnectAll(): void;
  onCancel(serial: string): void;
  onShowDiagnostics(): void;
}

export function ConnectionChrome({
  transport,
  browserReady,
  missingCapabilities,
  selectedDevice,
  activeSerial,
  streaming,
  busy,
  mode,
  onSelectDevice,
  onReconnect,
  onConnect,
  onToggleMode,
  onDisconnect,
  onDisconnectAll,
  onCancel,
  onShowDiagnostics,
}: ConnectionChromeProps) {
  const connectedSerials = new Set(
    transport.connected.map((device) => device.serial),
  );
  const pendingSerials = new Set(
    transport.pending.map((item) => item.descriptor.serial),
  );
  const activeDescriptor = transport.connected.find(
    (device) => device.serial === activeSerial,
  );
  const connected = transport.connected.length > 0;
  const phaseLabel = connectionPhaseLabel({
    busy,
    streaming,
    snapshot: transport,
  });
  const pendingPresentation = pendingConnectionPresentation(transport);
  const connectionName =
    activeDescriptor?.label ??
    transport.pending[0]?.descriptor.label ??
    "No Android connected";

  return (
    <>
      <header className="topbar">
        <a className="brand" href="#" aria-label="OpenDroid Remote home">
          <span className="brand-mark" aria-hidden="true">
            OD
          </span>
          <span className="brand-text">
            <strong>OpenDroid</strong>
            <small>Remote</small>
          </span>
        </a>

        <div className="connection-summary">
          <span
            className={`connection-pill ${
              streaming
                ? "is-live"
                : transport.phase === "error"
                  ? "is-error"
                  : ""
            }`}
          >
            <span className="status-dot" />
            {phaseLabel}
          </span>
          <span className="connection-name" title={connectionName}>
            {connectionName}
          </span>
        </div>

        <div className="connection-actions">
          {transport.devices.length > 0 ? (
            <div style={{ minWidth: 200, maxWidth: 280 }}>
              <CustomSelect
                value={selectedDevice}
                disabled={busy}
                placeholder="Choose a device"
                aria-label="Android device"
                onChange={onSelectDevice}
                options={[
                  ...(!selectedDevice ? [{ value: "", label: "Choose a device" }] : []),
                  ...transport.devices.map((device) => {
                    const pending = transport.pending.find(
                      (item) => item.descriptor.serial === device.serial,
                    );
                    const statusText = device.serial === activeSerial
                      ? "Live"
                      : connectedSerials.has(device.serial)
                        ? "ADB ready"
                        : pending?.stage === "reconnecting"
                          ? "Reconnecting"
                          : pending
                            ? "Connecting"
                            : "Authorized";
                    return {
                      value: device.serial,
                      label: `${device.label} — ${statusText}`,
                    };
                  }),
                ]}
              />
            </div>
          ) : null}
          {selectedDevice &&
          !connectedSerials.has(selectedDevice) &&
          !pendingSerials.has(selectedDevice) ? (
            <button
              type="button"
              className="button subtle"
              disabled={busy}
              onClick={() => onReconnect(selectedDevice)}
            >
              <IconRefresh size={16} />
              Reconnect
            </button>
          ) : null}
          <button
            type="button"
            className="button primary connect-button"
            disabled={
              transport.chooserOpen || missingCapabilities.length > 0
            }
            onClick={onConnect}
          >
            <IconUsb size={18} />
            {connected ? "Add USB device" : "Connect USB"}
          </button>
          {connected ? (
            <>
              <button
                type="button"
                className={`button game-button ${
                  mode === "play" ? "active" : ""
                }`}
                disabled={!streaming || busy}
                onClick={onToggleMode}
              >
                <IconGamepad size={18} />
                {mode === "play" ? "Edit mappings" : "Resume Play"}
              </button>
              <button
                type="button"
                className="button subtle"
                disabled={busy || !activeDescriptor}
                onClick={() => onDisconnect(activeSerial)}
              >
                Disconnect active
              </button>
              {transport.connected.length > 1 ? (
                <button
                  type="button"
                  className="button subtle"
                  disabled={busy}
                  onClick={onDisconnectAll}
                >
                  Disconnect all
                </button>
              ) : null}
            </>
          ) : null}
        </div>
      </header>

      {browserReady && missingCapabilities.length > 0 ? (
        <section className="capability-banner" role="alert">
          <span className="banner-icon" aria-hidden="true">
            <IconAlert size={20} />
          </span>
          <div>
            <strong>This browser cannot start a local Android session.</strong>
            <p>
              Missing: {missingCapabilities.join(", ")}. Use a current
              Chromium-based desktop browser over HTTPS or localhost.
            </p>
          </div>
          <button type="button" className="button subtle" onClick={onShowDiagnostics}>
            View checks
          </button>
        </section>
      ) : null}

      {pendingPresentation ? (
        <section
          className="authorization-banner"
          role="status"
          aria-live="polite"
        >
          <span className="banner-icon" aria-hidden="true">
            <IconUsb size={20} />
          </span>
          <div className="authorization-copy">
            <strong>{pendingPresentation.headline}</strong>
            <p>{pendingPresentation.description}</p>
            <div className="authorization-devices">
              {transport.pending.map((item) => (
                <div key={item.descriptor.serial}>
                  <span>
                    {item.descriptor.label}
                    <small>{pendingDeviceLabel(item.stage)}</small>
                  </span>
                  <button
                    type="button"
                    className="button subtle"
                    onClick={() => onCancel(item.descriptor.serial)}
                  >
                    Cancel
                  </button>
                </div>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {transport.connected.length > 1 ? (
        <section
          className="device-strip"
          aria-label="Connected Android devices"
        >
          <div className="device-strip-heading">
            <strong>Connected devices</strong>
            <span>
              {transport.connected.length} ADB transports · choose which one
              owns the video workspace
            </span>
          </div>
          <div className="device-cards">
            {transport.connected.map((device) => (
              <div
                className={`device-card ${
                  device.serial === activeSerial ? "active" : ""
                }`}
                key={device.serial}
              >
                <button
                  type="button"
                  className="device-card-select"
                  disabled={busy}
                  onClick={() => onSelectDevice(device.serial)}
                  aria-pressed={device.serial === activeSerial}
                >
                  <span>{device.model || device.name}</span>
                  <code>{device.serial}</code>
                  <small>
                    {device.serial === activeSerial
                      ? "Live control"
                      : "ADB ready"}
                  </small>
                </button>
                <button
                  type="button"
                  className="device-card-disconnect"
                  disabled={busy}
                  onClick={() => onDisconnect(device.serial)}
                  aria-label={`Disconnect ${device.label}`}
                  title={`Disconnect ${device.label}`}
                >
                  <IconClose size={16} />
                </button>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}
