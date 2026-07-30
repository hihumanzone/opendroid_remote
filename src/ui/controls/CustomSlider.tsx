"use client";

import {
  useCallback,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

export interface CustomSliderProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange(value: number): void;
  disabled?: boolean;
  className?: string;
  id?: string;
  "aria-label"?: string;
  title?: string;
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function roundToStep(val: number, min: number, max: number, step: number): number {
  const stepped = Math.round((val - min) / step) * step + min;
  // Fix floating point imprecision
  const precision = (step.toString().split(".")[1] || "").length;
  const fixed = Number(stepped.toFixed(precision));
  return clamp(fixed, min, max);
}

export function CustomSlider({
  value,
  min,
  max,
  step = 1,
  onChange,
  disabled = false,
  className = "",
  id,
  "aria-label": ariaLabel,
  title,
}: CustomSliderProps) {
  const [isDragging, setIsDragging] = useState(false);
  const trackRef = useRef<HTMLDivElement>(null);
  const generatedId = useId();
  const sliderId = id || generatedId;

  const percentage = max > min ? clamp(((value - min) / (max - min)) * 100, 0, 100) : 0;

  const updateValueFromPointer = useCallback(
    (clientX: number) => {
      if (!trackRef.current || disabled) return;
      const rect = trackRef.current.getBoundingClientRect();
      const relativeX = clientX - rect.left;
      const ratio = clamp(relativeX / rect.width, 0, 1);
      const rawVal = min + ratio * (max - min);
      const newVal = roundToStep(rawVal, min, max, step);
      if (newVal !== value) {
        onChange(newVal);
      }
    },
    [disabled, max, min, onChange, step, value],
  );

  const handlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    e.preventDefault();
    setIsDragging(true);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    updateValueFromPointer(e.clientX);
  };

  const handlePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (isDragging && !disabled) {
      updateValueFromPointer(e.clientX);
    }
  };

  const handlePointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (isDragging) {
      setIsDragging(false);
      try {
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        // ignore if not captured
      }
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;

    let delta = 0;
    switch (e.key) {
      case "ArrowRight":
      case "ArrowUp":
        delta = step;
        break;
      case "ArrowLeft":
      case "ArrowDown":
        delta = -step;
        break;
      case "PageUp":
        delta = step * 10;
        break;
      case "PageDown":
        delta = -step * 10;
        break;
      case "Home":
        e.preventDefault();
        onChange(min);
        return;
      case "End":
        e.preventDefault();
        onChange(max);
        return;
      default:
        return;
    }

    e.preventDefault();
    const newVal = roundToStep(value + delta, min, max, step);
    if (newVal !== value) {
      onChange(newVal);
    }
  };

  return (
    <div
      className={`custom-slider-root ${disabled ? "is-disabled" : ""} ${
        isDragging ? "is-dragging" : ""
      } ${className}`}
      title={title}
    >
      <div
        ref={trackRef}
        id={sliderId}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-valuenow={value}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-label={ariaLabel}
        aria-disabled={disabled}
        className="custom-slider-track-area"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onKeyDown={handleKeyDown}
      >
        <div className="custom-slider-track">
          <div
            className="custom-slider-fill"
            style={{ width: `${percentage}%` }}
          />
        </div>
        <div
          className="custom-slider-thumb"
          style={{ left: `${percentage}%` }}
        />
      </div>
    </div>
  );
}
