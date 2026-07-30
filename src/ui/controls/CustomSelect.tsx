"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { IconChevronDown, IconCheck } from "../icons/UiIcons";

export interface CustomSelectOption<T> {
  value: T;
  label: string;
  description?: string;
  disabled?: boolean;
}

export interface CustomSelectProps<T extends string | number> {
  value: T | undefined | null;
  options: readonly CustomSelectOption<T>[];
  onChange(value: T): void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  id?: string;
  "aria-label"?: string;
  title?: string;
}

export function CustomSelect<T extends string | number>({
  value,
  options,
  onChange,
  placeholder = "Select option...",
  disabled = false,
  className = "",
  id,
  "aria-label": ariaLabel,
  title,
}: CustomSelectProps<T>) {
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const listboxRef = useRef<HTMLDivElement>(null);
  const generatedId = useId();
  const selectId = id || generatedId;

  const selectedOption = options.find((opt) => opt.value === value);

  // Close when clicking outside
  useEffect(() => {
    if (!isOpen) return;

    function handleClickOutside(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  // Scroll highlighted item into view
  useEffect(() => {
    if (isOpen && highlightedIndex >= 0 && listboxRef.current) {
      const highlightedEl = listboxRef.current.children[
        highlightedIndex
      ] as HTMLElement;
      if (highlightedEl) {
        highlightedEl.scrollIntoView({ block: "nearest" });
      }
    }
  }, [isOpen, highlightedIndex]);

  const handleToggle = useCallback(() => {
    if (disabled) return;
    setIsOpen((prev) => {
      const next = !prev;
      if (next) {
        const currentIdx = options.findIndex((opt) => opt.value === value);
        setHighlightedIndex(currentIdx >= 0 ? currentIdx : 0);
      }
      return next;
    });
  }, [disabled, options, value]);

  const handleSelect = useCallback(
    (option: CustomSelectOption<T>) => {
      if (option.disabled) return;
      onChange(option.value);
      setIsOpen(false);
    },
    [onChange],
  );

  const handleKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;

    switch (e.key) {
      case "Enter":
      case " ":
        e.preventDefault();
        if (!isOpen) {
          handleToggle();
        } else if (highlightedIndex >= 0 && options[highlightedIndex]) {
          handleSelect(options[highlightedIndex]);
        }
        break;
      case "ArrowDown":
        e.preventDefault();
        if (!isOpen) {
          setIsOpen(true);
          setHighlightedIndex(0);
        } else {
          setHighlightedIndex((prev) => {
            let next = prev + 1;
            while (next < options.length && options[next]?.disabled) {
              next++;
            }
            return next < options.length ? next : prev;
          });
        }
        break;
      case "ArrowUp":
        e.preventDefault();
        if (!isOpen) {
          setIsOpen(true);
          setHighlightedIndex(options.length - 1);
        } else {
          setHighlightedIndex((prev) => {
            let next = prev - 1;
            while (next >= 0 && options[next]?.disabled) {
              next--;
            }
            return next >= 0 ? next : prev;
          });
        }
        break;
      case "Escape":
        if (isOpen) {
          e.preventDefault();
          setIsOpen(false);
        }
        break;
      case "Tab":
        if (isOpen) {
          setIsOpen(false);
        }
        break;
    }
  };

  return (
    <div
      ref={containerRef}
      className={`custom-select-container ${isOpen ? "is-open" : ""} ${
        disabled ? "is-disabled" : ""
      } ${className}`}
      title={title}
    >
      <button
        type="button"
        id={selectId}
        role="combobox"
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-label={ariaLabel}
        disabled={disabled}
        className="custom-select-trigger"
        onClick={handleToggle}
        onKeyDown={handleKeyDown}
      >
        <span className="custom-select-value">
          {selectedOption ? selectedOption.label : placeholder}
        </span>
        <IconChevronDown
          size={14}
          className={`custom-select-chevron ${isOpen ? "is-active" : ""}`}
        />
      </button>

      {isOpen ? (
        <div
          ref={listboxRef}
          role="listbox"
          id={`${selectId}-listbox`}
          aria-activedescendant={
            highlightedIndex >= 0
              ? `${selectId}-opt-${highlightedIndex}`
              : undefined
          }
          className="custom-select-dropdown"
        >
          {options.map((option, index) => {
            const isSelected = option.value === value;
            const isHighlighted = index === highlightedIndex;

            return (
              <div
                key={`${option.value}`}
                id={`${selectId}-opt-${index}`}
                role="option"
                aria-selected={isSelected}
                aria-disabled={option.disabled}
                className={`custom-select-option ${
                  isSelected ? "is-selected" : ""
                } ${isHighlighted ? "is-highlighted" : ""} ${
                  option.disabled ? "is-disabled" : ""
                }`}
                onClick={() => handleSelect(option)}
                onMouseEnter={() => {
                  if (!option.disabled) setHighlightedIndex(index);
                }}
              >
                <div className="custom-select-option-content">
                  <span className="custom-select-option-label">
                    {option.label}
                  </span>
                  {option.description ? (
                    <span className="custom-select-option-desc">
                      {option.description}
                    </span>
                  ) : null}
                </div>
                {isSelected ? (
                  <IconCheck size={14} className="custom-select-check" />
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
