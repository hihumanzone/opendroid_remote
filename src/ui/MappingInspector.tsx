"use client";

import { useEffect, useState } from "react";

import type { GameMapping } from "../profiles/schema";
import { CustomSelect } from "./controls/CustomSelect";

export interface MappingInspectorProps {
  mapping?: GameMapping;
  onChange(mapping: GameMapping): void;
  onDelete(id: string): void;
}

function NumberField({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange(value: number): void;
}) {
  const [text, setText] = useState(() => String(value));
  const [isFocused, setIsFocused] = useState(false);

  useEffect(() => {
    if (!isFocused) {
      setText(String(value));
    }
  }, [value, isFocused]);

  const commit = (raw: string) => {
    let next = Number(raw);
    if (!Number.isFinite(next) || raw.trim() === "") {
      next = value;
    }
    const clamped = Math.min(max, Math.max(min, next));
    const normalized = Number(clamped.toFixed(4));
    setText(String(normalized));
    onChange(normalized);
  };

  return (
    <label className="field">
      <span>{label}</span>
      <input
        type="number"
        value={text}
        min={min}
        max={max}
        step={step}
        onFocus={() => setIsFocused(true)}
        onChange={(event) => {
          const raw = event.target.value;
          setText(raw);
          const next = Number(raw);
          if (Number.isFinite(next) && next >= min && next <= max) {
            onChange(next);
          }
        }}
        onBlur={() => {
          setIsFocused(false);
          commit(text);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.currentTarget.blur();
          }
        }}
      />
    </label>
  );
}

function KeyCapture({
  label,
  code,
  onChange,
}: {
  label: string;
  code: string;
  onChange(code: string): void;
}) {
  const [capturing, setCapturing] = useState(false);
  return (
    <label className="field">
      <span>{label}</span>
      <button
        type="button"
        className={`key-capture ${capturing ? "is-capturing" : ""}`}
        onClick={() => setCapturing(true)}
        onKeyDown={(event) => {
          if (!capturing) return;
          event.preventDefault();
          event.stopPropagation();
          onChange(event.code);
          setCapturing(false);
        }}
        onBlur={() => setCapturing(false)}
      >
        {capturing ? "Press a key…" : code}
      </button>
    </label>
  );
}

export function MappingInspector({
  mapping,
  onChange,
  onDelete,
}: MappingInspectorProps) {
  if (!mapping) {
    return (
      <div className="empty-panel compact">
        <span className="empty-icon">◎</span>
        <p>Select an overlay to edit its trigger and touch behavior.</p>
      </div>
    );
  }

  const update = (patch: Partial<GameMapping>) =>
    onChange({ ...mapping, ...patch } as GameMapping);

  return (
    <div className="inspector">
      <div className="inspector-heading">
        <div>
          <span className="eyebrow">{mapping.type.replace("-", " ")}</span>
          <strong>{mapping.name}</strong>
        </div>
        <label className="switch">
          <input
            type="checkbox"
            checked={mapping.enabled}
            onChange={(event) => update({ enabled: event.target.checked })}
          />
          <span>Enabled</span>
        </label>
      </div>

      <label className="field">
        <span>Name</span>
        <input
          value={mapping.name}
          onChange={(event) => update({ name: event.target.value || "Mapping" })}
        />
      </label>

      <label className="field">
        <span>Orientation</span>
        <CustomSelect
          value={mapping.orientation}
          onChange={(val) =>
            update({
              orientation: val as GameMapping["orientation"],
            })
          }
          options={[
            { value: "any", label: "Any orientation" },
            { value: "landscape", label: "Landscape only" },
            { value: "portrait", label: "Portrait only" },
          ]}
        />
      </label>

      <div className="field-grid two">
        <NumberField
          label="X"
          value={Number(mapping.position.x.toFixed(4))}
          min={0}
          max={1}
          step={0.001}
          onChange={(x) => update({ position: { ...mapping.position, x } })}
        />
        <NumberField
          label="Y"
          value={Number(mapping.position.y.toFixed(4))}
          min={0}
          max={1}
          step={0.001}
          onChange={(y) => update({ position: { ...mapping.position, y } })}
        />
      </div>

      {mapping.type === "tap" ||
      mapping.type === "hold" ||
      mapping.type === "repeat" ||
      mapping.type === "swipe" ? (
        <KeyCapture
          label="Trigger"
          code={mapping.trigger.code}
          onChange={(code) =>
            onChange({ ...mapping, trigger: { kind: "key", code } })
          }
        />
      ) : null}

      {mapping.type === "tap" ? (
        <NumberField
          label="Tap duration (ms)"
          value={mapping.durationMs}
          min={20}
          max={1000}
          step={5}
          onChange={(durationMs) => onChange({ ...mapping, durationMs })}
        />
      ) : null}

      {mapping.type === "repeat" ? (
        <div className="field-grid two">
          <NumberField
            label="Interval (ms)"
            value={mapping.intervalMs}
            min={40}
            max={5000}
            step={5}
            onChange={(intervalMs) =>
              onChange({
                ...mapping,
                intervalMs,
                pressMs: Math.min(mapping.pressMs, intervalMs),
              })
            }
          />
          <NumberField
            label="Press (ms)"
            value={mapping.pressMs}
            min={15}
            max={mapping.intervalMs}
            step={5}
            onChange={(pressMs) => onChange({ ...mapping, pressMs })}
          />
        </div>
      ) : null}

      {mapping.type === "swipe" ? (
        <>
          <div className="field-grid two">
            <NumberField
              label="End X"
              value={Number(mapping.end.x.toFixed(4))}
              min={0}
              max={1}
              step={0.001}
              onChange={(x) => onChange({ ...mapping, end: { ...mapping.end, x } })}
            />
            <NumberField
              label="End Y"
              value={Number(mapping.end.y.toFixed(4))}
              min={0}
              max={1}
              step={0.001}
              onChange={(y) => onChange({ ...mapping, end: { ...mapping.end, y } })}
            />
          </div>
          <NumberField
            label="Duration (ms)"
            value={mapping.durationMs}
            min={40}
            max={5000}
            step={10}
            onChange={(durationMs) => onChange({ ...mapping, durationMs })}
          />
          <label className="switch inline">
            <input
              type="checkbox"
              checked={mapping.releaseOnComplete}
              onChange={(event) =>
                onChange({ ...mapping, releaseOnComplete: event.target.checked })
              }
            />
            <span>Release when swipe finishes</span>
          </label>
        </>
      ) : null}

      {mapping.type === "joystick" ? (
        <>
          <div className="field-grid two">
            {(["up", "down", "left", "right"] as const).map((direction) => (
              <KeyCapture
                key={direction}
                label={direction[0]!.toUpperCase() + direction.slice(1)}
                code={mapping.keys[direction]}
                onChange={(code) =>
                  onChange({
                    ...mapping,
                    keys: { ...mapping.keys, [direction]: code },
                  })
                }
              />
            ))}
          </div>
          <div className="field-grid two">
            <NumberField
              label="Radius"
              value={mapping.radius}
              min={0.01}
              max={0.5}
              step={0.005}
              onChange={(radius) => onChange({ ...mapping, radius })}
            />
            <NumberField
              label="Smoothing"
              value={mapping.smoothing}
              min={0}
              max={1}
              step={0.05}
              onChange={(smoothing) => onChange({ ...mapping, smoothing })}
            />
          </div>
        </>
      ) : null}

      {mapping.type === "mouse-button" ? (
        <>
          <label className="field">
            <span>Mouse button</span>
            <CustomSelect
              value={mapping.button}
              onChange={(val) =>
                onChange({ ...mapping, button: Number(val) })
              }
              options={[
                { value: 0, label: "Primary" },
                { value: 1, label: "Middle" },
                { value: 2, label: "Secondary" },
                { value: 3, label: "Back" },
                { value: 4, label: "Forward" },
              ]}
            />
          </label>
          <label className="field">
            <span>Behavior</span>
            <CustomSelect
              value={mapping.behavior}
              onChange={(val) =>
                onChange({
                  ...mapping,
                  behavior: val as "tap" | "hold",
                })
              }
              options={[
                { value: "hold", label: "Hold while pressed" },
                { value: "tap", label: "Timed tap" },
              ]}
            />
          </label>
          {mapping.behavior === "tap" ? (
            <NumberField
              label="Tap duration (ms)"
              value={mapping.durationMs}
              min={20}
              max={1000}
              step={5}
              onChange={(durationMs) => onChange({ ...mapping, durationMs })}
            />
          ) : null}
        </>
      ) : null}

      {mapping.type === "mouse-look" ? (
        <>
          <KeyCapture
            label="Toggle trigger"
            code={
              mapping.toggleTrigger?.code ??
              mapping.enableTrigger?.code ??
              "KeyY"
            }
            onChange={(code) =>
              onChange({
                ...mapping,
                toggleTrigger: { kind: "key", code },
                enableTrigger: undefined,
                disableTrigger: undefined,
              })
            }
          />
          <div className="field-grid two">
            <NumberField
              label="Sensitivity"
              value={mapping.sensitivity}
              min={0.0001}
              max={0.02}
              step={0.0001}
              onChange={(sensitivity) => onChange({ ...mapping, sensitivity })}
            />
            <NumberField
              label="Recenter radius"
              value={mapping.radius}
              min={0.02}
              max={0.5}
              step={0.01}
              onChange={(radius) => onChange({ ...mapping, radius })}
            />
          </div>
          <div className="field-grid two">
            <label className="switch inline">
              <input
                type="checkbox"
                checked={mapping.invertX}
                onChange={(event) =>
                  onChange({ ...mapping, invertX: event.target.checked })
                }
              />
              <span>Invert X</span>
            </label>
            <label className="switch inline">
              <input
                type="checkbox"
                checked={mapping.invertY}
                onChange={(event) =>
                  onChange({ ...mapping, invertY: event.target.checked })
                }
              />
              <span>Invert Y</span>
            </label>
          </div>
        </>
      ) : null}

      <button
        type="button"
        className="button danger subtle"
        onClick={() => onDelete(mapping.id)}
      >
        Delete mapping
      </button>
    </div>
  );
}
