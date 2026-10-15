"use client";

import { useState } from "react";

import type { GameMapping } from "../profiles/schema";
import { CustomSelect } from "./controls/CustomSelect";
import { SliderNumberField } from "./controls/SliderNumberField";

export interface MappingInspectorProps {
  mapping?: GameMapping;
  onChange(mapping: GameMapping): void;
  onDelete(id: string): void;
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

      <div className="inspector-card">
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
      </div>

      <div className="inspector-card">
        <span className="inspector-card-title">Placement</span>
        <div className="field-grid two">
          <SliderNumberField
            label="X"
            value={Number(mapping.position.x.toFixed(4))}
            min={0}
            max={1}
            step={0.001}
            sliderStep={0.005}
            precision={4}
            onChange={(x) => update({ position: { ...mapping.position, x } })}
          />
          <SliderNumberField
            label="Y"
            value={Number(mapping.position.y.toFixed(4))}
            min={0}
            max={1}
            step={0.001}
            sliderStep={0.005}
            precision={4}
            onChange={(y) => update({ position: { ...mapping.position, y } })}
          />
        </div>
      </div>

      {mapping.type === "tap" ||
      mapping.type === "hold" ||
      mapping.type === "repeat" ||
      mapping.type === "swipe" ? (
        <div className="inspector-card">
          <span className="inspector-card-title">Trigger</span>
          <KeyCapture
            label="Trigger key"
            code={mapping.trigger.code}
            onChange={(code) =>
              onChange({ ...mapping, trigger: { kind: "key", code } })
            }
          />
        </div>
      ) : null}

      {mapping.type === "tap" ? (
        <div className="inspector-card">
          <span className="inspector-card-title">Timing</span>
          <SliderNumberField
            label="Tap duration"
            value={mapping.durationMs}
            min={20}
            max={1000}
            step={5}
            unit="ms"
            precision={0}
            onChange={(durationMs) => onChange({ ...mapping, durationMs })}
          />
        </div>
      ) : null}

      {mapping.type === "repeat" ? (
        <div className="inspector-card">
          <span className="inspector-card-title">Repeat Dynamics</span>
          <div className="field-grid two">
            <SliderNumberField
              label="Interval"
              value={mapping.intervalMs}
              min={40}
              max={5000}
              sliderMax={2000}
              step={5}
              unit="ms"
              precision={0}
              onChange={(intervalMs) =>
                onChange({
                  ...mapping,
                  intervalMs,
                  pressMs: Math.min(mapping.pressMs, intervalMs),
                })
              }
            />
            <SliderNumberField
              label="Press duration"
              value={mapping.pressMs}
              min={15}
              max={mapping.intervalMs}
              sliderMax={mapping.intervalMs}
              step={5}
              unit="ms"
              precision={0}
              onChange={(pressMs) => onChange({ ...mapping, pressMs })}
            />
          </div>
        </div>
      ) : null}

      {mapping.type === "swipe" ? (
        <div className="inspector-card">
          <span className="inspector-card-title">Swipe Endpoint & Timing</span>
          <div className="field-grid two">
            <SliderNumberField
              label="End X"
              value={Number(mapping.end.x.toFixed(4))}
              min={0}
              max={1}
              step={0.001}
              sliderStep={0.005}
              precision={4}
              onChange={(x) => onChange({ ...mapping, end: { ...mapping.end, x } })}
            />
            <SliderNumberField
              label="End Y"
              value={Number(mapping.end.y.toFixed(4))}
              min={0}
              max={1}
              step={0.001}
              sliderStep={0.005}
              precision={4}
              onChange={(y) => onChange({ ...mapping, end: { ...mapping.end, y } })}
            />
          </div>
          <SliderNumberField
            label="Duration"
            value={mapping.durationMs}
            min={40}
            max={5000}
            sliderMax={2000}
            step={10}
            unit="ms"
            precision={0}
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
        </div>
      ) : null}

      {mapping.type === "joystick" ? (
        <div className="inspector-card">
          <span className="inspector-card-title">Directional Keys</span>
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
          <span className="inspector-card-title" style={{ marginTop: "12px" }}>
            Movement Dynamics
          </span>
          <div className="field-grid two">
            <SliderNumberField
              label="Radius"
              value={mapping.radius}
              min={0.01}
              max={0.5}
              step={0.001}
              sliderStep={0.005}
              precision={3}
              onChange={(radius) => onChange({ ...mapping, radius })}
            />
            <SliderNumberField
              label="Smoothing"
              value={mapping.smoothing}
              min={0}
              max={1}
              step={0.01}
              sliderStep={0.01}
              precision={2}
              onChange={(smoothing) => onChange({ ...mapping, smoothing })}
            />
          </div>
        </div>
      ) : null}

      {mapping.type === "mouse-button" ? (
        <div className="inspector-card">
          <span className="inspector-card-title">Mouse Trigger & Behavior</span>
          <label className="field">
            <span>Mouse button</span>
            <CustomSelect
              value={mapping.button}
              onChange={(val) =>
                onChange({ ...mapping, button: Number(val) })
              }
              options={[
                { value: 0, label: "Primary (Left)" },
                { value: 1, label: "Middle" },
                { value: 2, label: "Secondary (Right)" },
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
            <SliderNumberField
              label="Tap duration"
              value={mapping.durationMs}
              min={20}
              max={1000}
              step={5}
              unit="ms"
              precision={0}
              onChange={(durationMs) => onChange({ ...mapping, durationMs })}
            />
          ) : null}
        </div>
      ) : null}

      {mapping.type === "mouse-look" ? (
        <div className="inspector-card">
          <span className="inspector-card-title">Camera Look & Sensitivity</span>
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
            <SliderNumberField
              label="Sensitivity"
              value={mapping.sensitivity}
              min={0.0001}
              max={0.02}
              sliderMax={0.01}
              step={0.0001}
              precision={4}
              onChange={(sensitivity) => onChange({ ...mapping, sensitivity })}
            />
            <SliderNumberField
              label="Recenter radius"
              value={mapping.radius}
              min={0.02}
              max={0.5}
              step={0.005}
              sliderStep={0.01}
              precision={3}
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
        </div>
      ) : null}

      <div className="inspector-footer">
        <button
          type="button"
          className="button danger subtle"
          onClick={() => onDelete(mapping.id)}
        >
          Delete mapping
        </button>
      </div>
    </div>
  );
}
