"use client";

import type {
  AudioCodecPreference,
  SessionStats,
  StreamQuality,
  VideoCodec,
} from "../core/types";
import type {
  ConnectionPreferences,
} from "../settings/AppSettings";
import { streamQualityIssues } from "../settings/AppSettings";
import type {
  AndroidCapabilities,
  AudioPlaybackSnapshot,
} from "../scrcpy/ScrcpySession";
import { IconRefresh } from "./icons/UiIcons";

export interface StreamPanelProps {
  quality: StreamQuality;
  connection: ConnectionPreferences;
  capabilities?: AndroidCapabilities;
  stats: SessionStats;
  audio: AudioPlaybackSnapshot;
  audioSupported: boolean;
  streaming: boolean;
  busy: boolean;
  onChange(quality: StreamQuality): void;
  onConnectionChange(preferences: ConnectionPreferences): void;
  onApply(): void;
  onRefresh(): void;
  onResumeAudio(): void;
  onReset(): void;
}

const RESOLUTION_PRESETS = [
  { value: 0, label: "Native / unlimited" },
  { value: 1280, label: "720p class · 1280 max" },
  { value: 1920, label: "1080p class · 1920 max" },
  { value: 2560, label: "1440p class · 2560 max" },
  { value: 3840, label: "4K class · 3840 max" },
] as const;

function megabits(bits: number): number {
  return bits / 1_000_000;
}

function applyPerformancePreset(
  quality: StreamQuality,
  preset: "latency" | "balanced" | "quality",
): StreamQuality {
  switch (preset) {
    case "latency":
      return {
        ...quality,
        maxSize: 1280,
        bitRate: 4_000_000,
        maxFps: 60,
        iFrameInterval: 1,
        hardwareAcceleration: "prefer-hardware",
        audio: { ...quality.audio, bufferMs: 30, bitRate: 96_000 },
      };
    case "quality":
      return {
        ...quality,
        maxSize: 0,
        bitRate: 20_000_000,
        maxFps: 60,
        iFrameInterval: 5,
        hardwareAcceleration: "no-preference",
        audio: { ...quality.audio, bufferMs: 100, bitRate: 192_000 },
      };
    case "balanced":
      return {
        ...quality,
        maxSize: 1920,
        bitRate: 8_000_000,
        maxFps: 60,
        iFrameInterval: undefined,
        hardwareAcceleration: "no-preference",
        audio: { ...quality.audio, bufferMs: 60, bitRate: 128_000 },
      };
  }
}

export function StreamPanel({
  quality,
  connection,
  capabilities,
  stats,
  audio,
  audioSupported,
  streaming,
  busy,
  onChange,
  onConnectionChange,
  onApply,
  onRefresh,
  onResumeAudio,
  onReset,
}: StreamPanelProps) {
  const issues = streamQualityIssues(quality);
  const presetValue = RESOLUTION_PRESETS.some(
    (preset) => preset.value === quality.maxSize,
  )
    ? String(quality.maxSize)
    : "custom";
  const availableEncoders = (capabilities?.encoders ?? []).filter(
    (encoder) => quality.codec === "auto" || encoder.codec === quality.codec,
  );
  const availableAudioEncoders = (
    capabilities?.audioEncoders ?? []
  ).filter(
    (encoder) =>
      quality.audio.codec !== "raw" &&
      (quality.audio.codec === "auto" ||
        encoder.codec === quality.audio.codec),
  );
  const compressedAudio =
    quality.audio.codec !== "auto" && quality.audio.codec !== "raw";

  return (
    <div className="panel-stack">
      <section className="panel-section">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Persisted per device</span>
            <h3>Stream quality</h3>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={onRefresh}
            disabled={busy}
            aria-label="Refresh device capabilities"
            title="Refresh displays, encoders, and browser codecs"
          >
            <IconRefresh size={16} />
          </button>
        </div>

        <p className="profile-intro">
          Automatic defaults favor compatibility. Changes are saved for this
          device and take effect when the stream restarts.
        </p>

        <label className="field">
          <span>Performance preset</span>
          <select
            defaultValue=""
            onChange={(event) => {
              if (!event.target.value) return;
              onChange(
                applyPerformancePreset(
                  quality,
                  event.target.value as "latency" | "balanced" | "quality",
                ),
              );
              event.currentTarget.value = "";
            }}
          >
            <option value="">Choose without replacing custom values…</option>
            <option value="latency">Low latency · 1280 / 4 Mbps</option>
            <option value="balanced">Balanced · 1920 / 8 Mbps</option>
            <option value="quality">High quality · native / 20 Mbps</option>
          </select>
        </label>

        <label className="field">
          <span>Source display</span>
          <select
            value={quality.displayId ?? ""}
            onChange={(event) =>
              onChange({
                ...quality,
                displayId:
                  event.target.value === ""
                    ? undefined
                    : Number(event.target.value),
              })
            }
          >
            <option value="">Auto · focused / server default</option>
            {(capabilities?.displays ?? []).map((display) => (
              <option key={display.id} value={display.id}>
                Display {display.id}
                {display.resolution ? ` · ${display.resolution}` : ""}
                {display.focused ? " · focused" : ""}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Resolution / maximum dimension</span>
          <select
            value={presetValue}
            onChange={(event) => {
              if (event.target.value === "custom") return;
              onChange({ ...quality, maxSize: Number(event.target.value) });
            }}
          >
            {RESOLUTION_PRESETS.map((preset) => (
              <option key={preset.value} value={preset.value}>
                {preset.label}
              </option>
            ))}
            <option value="custom">Custom · {quality.maxSize} px</option>
          </select>
        </label>
        <label className="field">
          <span>Custom maximum dimension (0 = native)</span>
          <input
            type="number"
            min={0}
            max={8192}
            step={16}
            value={quality.maxSize}
            onChange={(event) =>
              onChange({ ...quality, maxSize: Number(event.target.value) })
            }
          />
        </label>

        <div className="field-grid two">
          <label className="field">
            <span>Video codec</span>
            <select
              value={quality.codec}
              onChange={(event) =>
                onChange({
                  ...quality,
                  codec: event.target.value as "auto" | VideoCodec,
                  encoder: undefined,
                })
              }
            >
              <option value="auto">Auto · reliability first</option>
              <option value="h264" disabled={!capabilities?.browserCodecs.h264}>
                H.264
              </option>
              <option value="h265" disabled={!capabilities?.browserCodecs.h265}>
                H.265
              </option>
              <option value="av1" disabled={!capabilities?.browserCodecs.av1}>
                AV1
              </option>
            </select>
          </label>
          <label className="field">
            <span>Android encoder</span>
            <select
              value={quality.encoder ?? ""}
              onChange={(event) =>
                onChange({
                  ...quality,
                  encoder: event.target.value || undefined,
                })
              }
            >
              <option value="">Negotiated default</option>
              {availableEncoders.map((encoder) => (
                <option
                  key={`${encoder.codec}:${encoder.name}`}
                  value={encoder.name}
                >
                  {encoder.name} · {encoder.hardwareType ?? "unknown"}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="range-field">
          <span>
            Video bitrate{" "}
            <output>{megabits(quality.bitRate).toFixed(1)} Mbps</output>
          </span>
          <input
            type="range"
            min={500_000}
            max={50_000_000}
            step={500_000}
            value={quality.bitRate}
            onChange={(event) =>
              onChange({ ...quality, bitRate: Number(event.target.value) })
            }
          />
        </label>

        <div className="field-grid two">
          <label className="field">
            <span>Frame limit (0 = unlimited)</span>
            <input
              type="number"
              min={0}
              max={240}
              step={1}
              value={quality.maxFps}
              onChange={(event) =>
                onChange({ ...quality, maxFps: Number(event.target.value) })
              }
            />
          </label>
          <label className="field">
            <span>I-frame interval (seconds)</span>
            <input
              type="number"
              min={0}
              max={60}
              step={0.5}
              value={quality.iFrameInterval ?? ""}
              placeholder="Android default"
              onChange={(event) =>
                onChange({
                  ...quality,
                  iFrameInterval:
                    event.target.value === ""
                      ? undefined
                      : Number(event.target.value),
                })
              }
            />
          </label>
        </div>

        <label className="field">
          <span>Crop (optional)</span>
          <input
            value={quality.crop ?? ""}
            placeholder="width:height:x:y"
            aria-invalid={issues.some((issue) => issue.startsWith("Crop"))}
            onChange={(event) =>
              onChange({ ...quality, crop: event.target.value || undefined })
            }
          />
        </label>

        <div className="stream-subsection">
          <div className="subsection-heading">
            <span>
              <strong>Computer audio</strong>
              <small className={`audio-status is-${audio.status}`}>
                {audio.status}
              </small>
            </span>
            {audio.status === "blocked" ? (
              <button
                type="button"
                className="button subtle compact"
                onClick={onResumeAudio}
              >
                Enable audio
              </button>
            ) : null}
          </div>
          <label className="switch inline">
            <input
              type="checkbox"
              checked={quality.audio.enabled}
              disabled={!audioSupported}
              onChange={(event) =>
                onChange({
                  ...quality,
                  audio: { ...quality.audio, enabled: event.target.checked },
                })
              }
            />
            <span>Stream Android audio to this computer</span>
          </label>
          <div className="field-grid two">
            <label className="field">
              <span>Audio codec</span>
              <select
                value={quality.audio.codec}
                disabled={!quality.audio.enabled}
                onChange={(event) =>
                  onChange({
                    ...quality,
                    audio: {
                      ...quality.audio,
                      codec: event.target.value as AudioCodecPreference,
                      encoder: undefined,
                    },
                  })
                }
              >
                <option value="auto">Auto · raw reliability</option>
                <option
                  value="raw"
                  disabled={!capabilities?.browserAudioCodecs.raw}
                >
                  Raw PCM · lossless
                </option>
                <option
                  value="opus"
                  disabled={!capabilities?.browserAudioCodecs.opus}
                >
                  Opus
                </option>
                <option
                  value="aac"
                  disabled={!capabilities?.browserAudioCodecs.aac}
                >
                  AAC
                </option>
                <option
                  value="flac"
                  disabled={!capabilities?.browserAudioCodecs.flac}
                >
                  FLAC
                </option>
              </select>
            </label>
            <label className="field">
              <span>Audio encoder</span>
              <select
                value={quality.audio.encoder ?? ""}
                disabled={!compressedAudio}
                onChange={(event) =>
                  onChange({
                    ...quality,
                    audio: {
                      ...quality.audio,
                      encoder: event.target.value || undefined,
                    },
                  })
                }
              >
                <option value="">Android default</option>
                {availableAudioEncoders.map((encoder) => (
                  <option
                    key={`${encoder.codec}:${encoder.name}`}
                    value={encoder.name}
                  >
                    {encoder.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="range-field">
            <span>
              Compressed audio bitrate{" "}
              <output>{Math.round(quality.audio.bitRate / 1000)} kbps</output>
            </span>
            <input
              type="range"
              min={32_000}
              max={512_000}
              step={16_000}
              value={quality.audio.bitRate}
              disabled={!quality.audio.enabled || !compressedAudio}
              onChange={(event) =>
                onChange({
                  ...quality,
                  audio: {
                    ...quality.audio,
                    bitRate: Number(event.target.value),
                  },
                })
              }
            />
          </label>
          <label className="range-field">
            <span>
              Playback buffer{" "}
              <output>{quality.audio.bufferMs} ms</output>
            </span>
            <input
              type="range"
              min={20}
              max={250}
              step={5}
              value={quality.audio.bufferMs}
              disabled={!quality.audio.enabled}
              onChange={(event) =>
                onChange({
                  ...quality,
                  audio: {
                    ...quality.audio,
                    bufferMs: Number(event.target.value),
                  },
                })
              }
            />
          </label>
          <label className="range-field">
            <span>
              Computer volume{" "}
              <output>{Math.round(quality.audio.volume * 100)}%</output>
            </span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={quality.audio.volume}
              disabled={!quality.audio.enabled}
              onChange={(event) =>
                onChange({
                  ...quality,
                  audio: {
                    ...quality.audio,
                    volume: Number(event.target.value),
                  },
                })
              }
            />
          </label>
          <label className="switch inline">
            <input
              type="checkbox"
              checked={quality.audio.duplicateOnDevice}
              disabled={!quality.audio.enabled}
              onChange={(event) =>
                onChange({
                  ...quality,
                  audio: {
                    ...quality.audio,
                    duplicateOnDevice: event.target.checked,
                  },
                })
              }
            />
            <span>Also play on Android (Android 13+)</span>
          </label>
          <p className="muted audio-help">
            Auto/raw is the most compatible lossless path. Compressed codecs
            are selectable only when this browser reports decoder support.
            Device duplication uses scrcpy’s playback capture source.
          </p>
          {audio.message ? <p className="audio-message">{audio.message}</p> : null}
        </div>

        <details className="settings-disclosure">
          <summary>Latency, decoder, and rendering</summary>
          <div className="settings-disclosure-body">
            <label className="field">
              <span>Browser renderer</span>
              <select
                value={quality.renderer}
                onChange={(event) =>
                  onChange({
                    ...quality,
                    renderer: event.target
                      .value as StreamQuality["renderer"],
                  })
                }
              >
                <option value="auto">Auto · WebGL then bitmap fallback</option>
                <option value="webgl">Require WebGL</option>
                <option value="bitmap">Bitmap renderer</option>
              </select>
            </label>
            <label className="field">
              <span>Decoder hardware preference</span>
              <select
                value={quality.hardwareAcceleration}
                onChange={(event) =>
                  onChange({
                    ...quality,
                    hardwareAcceleration: event.target
                      .value as StreamQuality["hardwareAcceleration"],
                  })
                }
              >
                <option value="no-preference">Browser automatic</option>
                <option value="prefer-hardware">Prefer hardware</option>
                <option value="prefer-software">Prefer software</option>
              </select>
            </label>
          </div>
        </details>

        <details className="settings-disclosure" open>
          <summary>Mouse input</summary>
          <div className="settings-disclosure-body">
            <label className="field">
              <span>Android mouse mode</span>
              <select
                value={quality.mouse.mode}
                onChange={(event) =>
                  onChange({
                    ...quality,
                    mouse: {
                      ...quality.mouse,
                      mode: event.target
                        .value as StreamQuality["mouse"]["mode"],
                    },
                  })
                }
              >
                <option value="uhid">
                  Physical UHID mouse · relative, recommended
                </option>
                <option value="sdk">
                  SDK compatibility · absolute (explicit opt-in)
                </option>
                <option value="disabled">
                  Disabled · mappings and touchscreen only
                </option>
              </select>
            </label>

            {quality.mouse.mode === "uhid" ? (
              <>
                <label className="field">
                  <span>Physical mouse sensitivity</span>
                  <input
                    type="number"
                    min={0.1}
                    max={4}
                    step={0.05}
                    value={quality.mouse.sensitivity}
                    onChange={(event) =>
                      onChange({
                        ...quality,
                        mouse: {
                          ...quality.mouse,
                          sensitivity: Number(event.target.value),
                        },
                      })
                    }
                  />
                </label>
                <label className="switch inline">
                  <input
                    type="checkbox"
                    checked={quality.mouse.rawInput}
                    onChange={(event) =>
                      onChange({
                        ...quality,
                        mouse: {
                          ...quality.mouse,
                          rawInput: event.target.checked,
                        },
                      })
                    }
                  />
                  <span>
                    Request unadjusted browser movement when supported
                  </span>
                </label>
                <p className="muted">
                  Click the Android display to capture the mouse. Movement,
                  five buttons, and both wheel axes are sent as physical HID
                  reports. Press Esc to release capture.
                </p>
                {capabilities && !capabilities.uhidMouse.supported ? (
                  <p className="settings-warning" role="status">
                    Physical mouse access is unavailable on this device:
                    {" "}
                    {capabilities.uhidMouse.reason} Direct mouse input stays
                    disabled so it is never silently converted to touch.
                    Select SDK compatibility explicitly if needed.
                  </p>
                ) : null}
              </>
            ) : quality.mouse.mode === "sdk" ? (
              <p className="muted">
                Uses scrcpy&apos;s absolute Android input compatibility path.
                Hover and secondary-button events have mouse semantics, but
                some Android versions or apps may treat primary clicks as
                touch-compatible input. Choose UHID for physical-mouse
                semantics.
              </p>
            ) : (
              <p className="muted">
                Ordinary mouse input is not forwarded. Explicit mouse-button
                and mouse-look mappings may still emulate configured touches.
              </p>
            )}
          </div>
        </details>

        <details className="settings-disclosure">
          <summary>Compatibility and reconnect</summary>
          <div className="settings-disclosure-body">
            <label className="field">
              <span>ADB scrcpy tunnel</span>
              <select
                value={quality.tunnel}
                onChange={(event) =>
                  onChange({
                    ...quality,
                    tunnel: event.target.value as StreamQuality["tunnel"],
                  })
                }
              >
                <option value="auto">Auto · reverse then forward</option>
                <option value="reverse">Prefer reverse</option>
                <option value="forward">Force forward</option>
              </select>
            </label>
            <label className="field">
              <span>Capture orientation</span>
              <select
                value={quality.captureOrientation}
                onChange={(event) =>
                  onChange({
                    ...quality,
                    captureOrientation: event.target
                      .value as StreamQuality["captureOrientation"],
                  })
                }
              >
                <option value="auto">Auto · follow Android</option>
                <option value="initial">Lock initial orientation</option>
                <option value="0">Lock 0°</option>
                <option value="90">Lock 90°</option>
                <option value="180">Lock 180°</option>
                <option value="270">Lock 270°</option>
              </select>
            </label>
            <label className="switch inline">
              <input
                type="checkbox"
                checked={quality.downsizeOnError}
                onChange={(event) =>
                  onChange({
                    ...quality,
                    downsizeOnError: event.target.checked,
                  })
                }
              />
              <span>Downsize automatically if the encoder rejects a size</span>
            </label>
            <label className="switch inline">
              <input
                type="checkbox"
                checked={quality.powerOn}
                onChange={(event) =>
                  onChange({ ...quality, powerOn: event.target.checked })
                }
              />
              <span>Wake Android when the stream starts</span>
            </label>
            <label className="switch inline">
              <input
                type="checkbox"
                checked={quality.stayAwake}
                onChange={(event) =>
                  onChange({ ...quality, stayAwake: event.target.checked })
                }
              />
              <span>Keep Android awake while plugged in</span>
            </label>
            <label className="switch inline">
              <input
                type="checkbox"
                checked={quality.showTouches}
                onChange={(event) =>
                  onChange({ ...quality, showTouches: event.target.checked })
                }
              />
              <span>Ask Android to visualize injected touches</span>
            </label>
            <label className="switch inline">
              <input
                type="checkbox"
                checked={quality.clipboardAutosync}
                onChange={(event) =>
                  onChange({
                    ...quality,
                    clipboardAutosync: event.target.checked,
                  })
                }
              />
              <span>Synchronize Android clipboard automatically</span>
            </label>
            <label className="switch inline">
              <input
                type="checkbox"
                checked={connection.autoReconnect}
                onChange={(event) =>
                  onConnectionChange({
                    ...connection,
                    autoReconnect: event.target.checked,
                  })
                }
              />
              <span>Reconnect trusted USB devices automatically</span>
            </label>
            <label className="switch inline">
              <input
                type="checkbox"
                checked={connection.resumeStream}
                disabled={!connection.autoReconnect}
                onChange={(event) =>
                  onConnectionChange({
                    ...connection,
                    resumeStream: event.target.checked,
                  })
                }
              />
              <span>Resume mirroring after a temporary disconnect</span>
            </label>
          </div>
        </details>

        {issues.length > 0 ? (
          <ul className="settings-errors">
            {issues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        ) : null}

        <div className="button-row">
          <button
            type="button"
            className="button subtle"
            onClick={onReset}
          >
            Reset device override
          </button>
          <button
            type="button"
            className="button primary"
            disabled={!streaming || busy || issues.length > 0}
            onClick={onApply}
          >
            Apply & restart
          </button>
        </div>
      </section>

      <section className="panel-section">
        <span className="eyebrow">Live telemetry</span>
        <div className="stat-grid">
          <div>
            <span>Frame</span>
            <strong>
              {stats.width && stats.height
                ? `${stats.width}×${stats.height}`
                : "—"}
            </strong>
          </div>
          <div>
            <span>Codec</span>
            <strong>{stats.codec?.toUpperCase() ?? "—"}</strong>
          </div>
          <div>
            <span>Rendered</span>
            <strong>{stats.framesRendered.toLocaleString()}</strong>
          </div>
          <div>
            <span>Skipped</span>
            <strong>{stats.framesSkipped.toLocaleString()}</strong>
          </div>
        </div>
      </section>

      <section className="panel-section">
        <span className="eyebrow">Detected displays</span>
        {(capabilities?.displays.length ?? 0) === 0 ? (
          <p className="muted">
            No explicit display list was returned. Auto mode lets scrcpy choose
            the source without assuming an ID.
          </p>
        ) : (
          <ul className="capability-list">
            {capabilities!.displays.map((display) => (
              <li key={display.id}>
                <span className={`mini-dot ${display.focused ? "ok" : ""}`} />
                <span>
                  Display {display.id}
                  <small>{display.resolution ?? "size not reported"}</small>
                </span>
                {display.focused ? <em>Focused</em> : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
