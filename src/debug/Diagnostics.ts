export type DiagnosticLevel = "debug" | "info" | "warn" | "error";
export type DiagnosticCategory =
  | "browser"
  | "webusb"
  | "adb"
  | "scrcpy"
  | "display"
  | "codec"
  | "audio"
  | "control"
  | "profile"
  | "settings"
  | "ui";

export interface DiagnosticEntry {
  id: number;
  timestamp: string;
  elapsedMs: number;
  level: DiagnosticLevel;
  category: DiagnosticCategory;
  event: string;
  message: string;
  details?: unknown;
}

export type DiagnosticListener = (entries: readonly DiagnosticEntry[]) => void;

function sanitizeDetails(
  value: unknown,
  seen = new WeakSet<object>(),
  depth = 0,
): unknown {
  if (depth > 12) {
    return "[maximum diagnostic depth reached]";
  }
  if (value instanceof Error) {
    if (seen.has(value)) {
      return `[circular ${value.name}]`;
    }
    seen.add(value);
    const ownProperties = Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        sanitizeDetails(item, seen, depth + 1),
      ]),
    );
    const result = {
      name: value.name,
      message: value.message,
      stack: value.stack,
      ...ownProperties,
      ...(value.cause === undefined
        ? {}
        : { cause: sanitizeDetails(value.cause, seen, depth + 1) }),
    };
    seen.delete(value);
    return result;
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeDetails(item, seen, depth + 1));
  }
  if (value && typeof value === "object") {
    if (seen.has(value)) {
      return "[circular object]";
    }
    seen.add(value);
    const result = Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        sanitizeDetails(item, seen, depth + 1),
      ]),
    );
    seen.delete(value);
    return result;
  }
  return value;
}

export class Diagnostics {
  readonly #startedAt = performance.now();
  readonly #entries: DiagnosticEntry[] = [];
  readonly #listeners = new Set<DiagnosticListener>();
  readonly #errorListeners = new Set<(hasErrors: boolean) => void>();
  #nextId = 1;
  #hasErrors = false;

  constructor(private readonly maxEntries = 600) {}

  get entries(): readonly DiagnosticEntry[] {
    return this.#entries;
  }

  get hasErrors(): boolean {
    return this.#hasErrors;
  }

  subscribe(listener: DiagnosticListener): () => void {
    this.#listeners.add(listener);
    listener(this.#entries);
    return () => this.#listeners.delete(listener);
  }

  subscribeErrors(listener: (hasErrors: boolean) => void): () => void {
    this.#errorListeners.add(listener);
    listener(this.#hasErrors);
    return () => this.#errorListeners.delete(listener);
  }

  record(
    level: DiagnosticLevel,
    category: DiagnosticCategory,
    event: string,
    message: string,
    details?: unknown,
  ): void {
    this.#entries.push({
      id: this.#nextId++,
      timestamp: new Date().toISOString(),
      elapsedMs: Math.round(performance.now() - this.#startedAt),
      level,
      category,
      event,
      message,
      details: details === undefined ? undefined : sanitizeDetails(details),
    });
    if (this.#entries.length > this.maxEntries) {
      this.#entries.splice(0, this.#entries.length - this.maxEntries);
    }
    if (level === "error" && !this.#hasErrors) {
      this.#hasErrors = true;
      this.#emitErrors();
    }
    this.#emit();
  }

  debug(
    category: DiagnosticCategory,
    event: string,
    message: string,
    details?: unknown,
  ): void {
    this.record("debug", category, event, message, details);
  }

  info(
    category: DiagnosticCategory,
    event: string,
    message: string,
    details?: unknown,
  ): void {
    this.record("info", category, event, message, details);
  }

  warn(
    category: DiagnosticCategory,
    event: string,
    message: string,
    details?: unknown,
  ): void {
    this.record("warn", category, event, message, details);
  }

  error(
    category: DiagnosticCategory,
    event: string,
    message: string,
    details?: unknown,
  ): void {
    this.record("error", category, event, message, details);
  }

  clear(): void {
    this.#entries.length = 0;
    if (this.#hasErrors) {
      this.#hasErrors = false;
      this.#emitErrors();
    }
    this.#emit();
  }

  export(): string {
    return JSON.stringify(
      {
        schemaVersion: 1,
        exportedAt: new Date().toISOString(),
        userAgent:
          typeof navigator === "undefined" ? "unavailable" : navigator.userAgent,
        entries: this.#entries,
      },
      null,
      2,
    );
  }

  #emit(): void {
    for (const listener of this.#listeners) {
      listener(this.#entries);
    }
  }

  #emitErrors(): void {
    for (const listener of this.#errorListeners) {
      listener(this.#hasErrors);
    }
  }
}
