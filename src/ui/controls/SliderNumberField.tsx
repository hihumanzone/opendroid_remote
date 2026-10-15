"use client";

import { useEffect, useId, useState, type KeyboardEvent } from "react";
import { CustomSlider } from "./CustomSlider";

export interface SliderNumberFieldProps {
  label: string;
  value: number;
  min: number;
  max: number;
  sliderMin?: number;
  sliderMax?: number;
  step?: number;
  sliderStep?: number;
  precision?: number;
  unit?: string;
  disabled?: boolean;
  className?: string;
  onChange(value: number): void;
}

function getPrecision(step?: number): number {
  if (step === undefined) return 2;
  const parts = step.toString().split(".");
  return parts.length > 1 ? parts[1]!.length : 0;
}

function clamp(val: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, val));
}

function roundToPrecision(val: number, precision: number): number {
  const factor = 10 ** precision;
  return Math.round(val * factor) / factor;
}

export function SliderNumberField({
  label,
  value,
  min,
  max,
  sliderMin = min,
  sliderMax = max,
  step = 1,
  sliderStep,
  precision = getPrecision(step),
  unit,
  disabled = false,
  className = "",
  onChange,
}: SliderNumberFieldProps) {
  const inputId = useId();
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
    const clamped = clamp(next, min, max);
    const normalized = roundToPrecision(clamped, precision);
    setText(String(normalized));
    if (normalized !== value) {
      onChange(normalized);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.currentTarget.blur();
    }
  };

  const effectiveSliderStep = sliderStep ?? step;

  return (
    <div
      className={`slider-number-field ${disabled ? "is-disabled" : ""} ${className}`}
    >
      <div className="slider-number-header">
        <label htmlFor={inputId} className="slider-number-label">
          {label}
        </label>
        {unit ? <span className="slider-number-unit">{unit}</span> : null}
      </div>
      <div className="slider-number-controls">
        <CustomSlider
          id={`${inputId}-slider`}
          value={clamp(value, sliderMin, sliderMax)}
          min={sliderMin}
          max={sliderMax}
          step={effectiveSliderStep}
          disabled={disabled}
          aria-label={`${label} slider`}
          onChange={(newVal) => {
            const normalized = roundToPrecision(newVal, precision);
            setText(String(normalized));
            onChange(normalized);
          }}
        />
        <input
          id={inputId}
          type="number"
          className="slider-number-input"
          value={text}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          aria-label={`${label} value`}
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
          onKeyDown={handleKeyDown}
        />
      </div>
    </div>
  );
}
