"use client";

import type {
  BrowserCapabilities,
  CapabilityCheck,
} from "../capabilities/browserCapabilities";
import type { DiagnosticEntry } from "../debug/Diagnostics";
import type { AndroidCapabilities } from "../scrcpy/ScrcpySession";
import { IconCopy, IconDownload, IconTrash, IconCheck, IconClose } from "./icons/UiIcons";

export interface DiagnosticsPanelProps {
  entries: readonly DiagnosticEntry[];
  checks: readonly CapabilityCheck[];
  browser: BrowserCapabilities;
  android?: AndroidCapabilities;
  onCopy(): void;
  onExport(): void;
  onClear(): void;
}

export function DiagnosticsPanel({
  entries,
  checks,
  android,
  onCopy,
  onExport,
  onClear,
}: DiagnosticsPanelProps) {
  return (
    <div className="panel-stack">
      <section className="panel-section">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Runtime checks</span>
            <h3>Capabilities</h3>
          </div>
        </div>
        <ul className="check-list">
          {checks.map((check) => (
            <li key={check.id} title={check.detail}>
              <span className={`check-icon ${check.supported ? "ok" : "no"}`}>
                {check.supported ? <IconCheck size={14} /> : <IconClose size={14} />}
              </span>
              <span>
                {check.label}
                <small>{check.required ? "Required" : "Optional"}</small>
              </span>
            </li>
          ))}
        </ul>
      </section>

      {android ? (
        <section className="panel-section">
          <span className="eyebrow">Negotiation result</span>
          <div className="chip-wrap">
            {(["h264", "h265", "av1"] as const).map((codec) => (
              <span
                className={`capability-chip ${
                  android.browserCodecs[codec] ? "ok" : ""
                }`}
                key={codec}
              >
                {codec.toUpperCase()}{" "}
                {android.browserCodecs[codec] ? "decode" : "unavailable"}
              </span>
            ))}
            <span className="capability-chip ok">
              {android.displays.length} display
              {android.displays.length === 1 ? "" : "s"}
            </span>
            <span className="capability-chip ok">
              {android.encoders.length} encoder
              {android.encoders.length === 1 ? "" : "s"}
            </span>
          </div>
        </section>
      ) : null}

      <section className="panel-section diagnostics-section">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Local event log</span>
            <h3>Diagnostics</h3>
          </div>
          <span className="count-badge">{entries.length}</span>
        </div>
        <div className="diagnostic-actions" style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
          <button type="button" className="button subtle" style={{ flex: 1 }} onClick={onCopy}>
            <IconCopy size={14} />
            Copy
          </button>
          <button type="button" className="button subtle" style={{ flex: 1 }} onClick={onExport}>
            <IconDownload size={14} />
            Export
          </button>
          <button type="button" className="button subtle" style={{ flex: 1 }} onClick={onClear}>
            <IconTrash size={14} />
            Clear
          </button>
        </div>
        <div className="diagnostic-log" role="log" aria-live="polite">
          {entries.length === 0 ? (
            <p className="muted">Connection diagnostics will appear here.</p>
          ) : (
            entries
              .slice(-120)
              .reverse()
              .map((entry) => (
                <article className={`log-entry level-${entry.level}`} key={entry.id}>
                  <div>
                    <time>
                      +{(entry.elapsedMs / 1000).toFixed(2)}s · {entry.category}
                    </time>
                    <span>{entry.level}</span>
                  </div>
                  <p>{entry.message}</p>
                </article>
              ))
          )}
        </div>
      </section>
    </div>
  );
}

