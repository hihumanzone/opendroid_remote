import type { NormalizedPoint, Size } from "../core/types";
import { clamp } from "../core/types";
import { SerialTaskQueue } from "../core/SerialTaskQueue";
import type { Diagnostics } from "../debug/Diagnostics";
import type {
  GameMapping,
  GameProfile,
  JoystickMapping,
  MouseLookMapping,
  RepeatMapping,
  SwipeMapping,
} from "../profiles/schema";
import { KeyboardState } from "./KeyboardState";
import {
  joystickPoint,
  joystickVector,
  smoothVector,
  type JoystickVector,
} from "./joystick";
import { TouchRegistry, type SyntheticTouchSink } from "./TouchRegistry";

export interface MappingScheduler {
  now(): number;
  setTimeout(callback: () => void, delayMs: number): number;
  clearTimeout(id: number): void;
  setInterval(callback: () => void, delayMs: number): number;
  clearInterval(id: number): void;
  requestFrame(callback: (time: number) => void): number;
  cancelFrame(id: number): void;
}

export const browserMappingScheduler: MappingScheduler = {
  now: () => performance.now(),
  setTimeout: (callback, delayMs) =>
    window.setTimeout(callback, Math.max(0, delayMs)),
  clearTimeout: (id) => window.clearTimeout(id),
  setInterval: (callback, delayMs) =>
    window.setInterval(callback, Math.max(1, delayMs)),
  clearInterval: (id) => window.clearInterval(id),
  requestFrame: (callback) => window.requestAnimationFrame(callback),
  cancelFrame: (id) => window.cancelAnimationFrame(id),
};

interface RepeatState {
  intervalId: number;
  releaseId?: number;
}

interface SwipeState {
  frameId?: number;
  startedAt: number;
  released: boolean;
}

interface JoystickState {
  frameId?: number;
  current: JoystickVector;
}

export interface MappingEngineOptions {
  scheduler?: MappingScheduler;
  diagnostics?: Diagnostics;
  onEmergency?: (code: string) => void;
  getVideoSize?: () => Size;
}

export class MappingEngine {
  readonly #touches: TouchRegistry;
  readonly #keyboard = new KeyboardState();
  readonly #scheduler: MappingScheduler;
  readonly #diagnostics?: Diagnostics;
  readonly #onEmergency?: (code: string) => void;
  readonly #getVideoSize: () => Size;
  readonly #tapTimers = new Map<string, number>();
  readonly #repeats = new Map<string, RepeatState>();
  readonly #swipes = new Map<string, SwipeState>();
  readonly #joysticks = new Map<string, JoystickState>();
  readonly #mouseTapTimers = new Map<string, number>();
  readonly #lookPositions = new Map<string, NormalizedPoint>();
  readonly #pendingLookDeltas = new Map<string, { dx: number; dy: number }>();
  readonly #lookPumps = new Map<string, Promise<void>>();
  readonly #configurationQueue = new SerialTaskQueue();

  #profile: GameProfile;
  #enabled = false;
  #orientation: "portrait" | "landscape" = "landscape";
  #pointerLockActive = false;
  #lookGeneration = 0;
  #inputGeneration = 0;
  #configurationRevision = 0;

  constructor(
    sink: SyntheticTouchSink,
    profile: GameProfile,
    options: MappingEngineOptions = {},
  ) {
    this.#touches = new TouchRegistry(sink);
    this.#profile = structuredClone(profile);
    this.#scheduler = options.scheduler ?? browserMappingScheduler;
    this.#diagnostics = options.diagnostics;
    this.#onEmergency = options.onEmergency;
    this.#getVideoSize = options.getVideoSize ?? (() => ({ width: 1, height: 1 }));
  }

  get enabled(): boolean {
    return this.#enabled;
  }

  get profile(): GameProfile {
    return structuredClone(this.#profile);
  }

  get activeTouchCount(): number {
    return this.#touches.active.length;
  }

  setProfile(profile: GameProfile): Promise<void> {
    return this.configure(profile, this.#orientation, this.#enabled);
  }

  setOrientation(
    orientation: "portrait" | "landscape",
  ): Promise<void> {
    if (orientation === this.#orientation) return Promise.resolve();
    return this.configure(this.#profile, orientation, this.#enabled);
  }

  /**
   * Atomically replaces the mapping context. Rapid React/profile updates are
   * coalesced, active touches are released before the new context becomes
   * visible, and an existing Pointer Lock session is re-armed when possible.
   */
  configure(
    profile: GameProfile,
    orientation: "portrait" | "landscape",
    enabled: boolean,
  ): Promise<void> {
    const revision = ++this.#configurationRevision;
    const nextProfile = structuredClone(profile);
    return this.#configurationQueue.run(async () => {
      if (revision !== this.#configurationRevision) return;
      const wasEnabled = this.#enabled;
      const preservePointerLock = this.#pointerLockActive && enabled;
      this.#enabled = false;
      await this.#releaseInputState(!preservePointerLock);
      if (revision !== this.#configurationRevision) return;

      this.#profile = nextProfile;
      this.#orientation = orientation;
      this.#enabled = enabled;
      this.#pointerLockActive = preservePointerLock;
      if (this.#pointerLockActive) {
        await this.#beginMouseLookTouches();
      }
      if (wasEnabled !== enabled) {
        this.#logEnabledState(enabled);
      }
    });
  }

  setEnabled(enabled: boolean): Promise<void> {
    return this.configure(this.#profile, this.#orientation, enabled);
  }

  async emergencyStop(code = this.#profile.settings.emergencyCode): Promise<void> {
    this.#configurationRevision += 1;
    this.#enabled = false;
    await this.#configurationQueue.run(() => this.#releaseInputState(true));
    this.#diagnostics?.warn(
      "control",
      "emergency-stop",
      `Emergency stop triggered by ${code}.`,
    );
    this.#onEmergency?.(code);
  }

  async handleKeyDown(code: string, repeated = false): Promise<boolean> {
    if (code === this.#profile.settings.emergencyCode) {
      await this.emergencyStop(code);
      return true;
    }
    if (!this.#enabled) return false;
    const firstPress = this.#keyboard.press(code);
    if (!firstPress || repeated) {
      return this.#isMappedKey(code);
    }

    let consumed = false;
    for (const mapping of this.#activeMappings()) {
      switch (mapping.type) {
        case "tap":
          if (mapping.trigger.code === code) {
            consumed = true;
            await this.#startTap(mapping.id, mapping.position, mapping.durationMs);
          }
          break;
        case "hold":
          if (mapping.trigger.code === code) {
            consumed = true;
            await this.#touches.begin(mapping.id, mapping.position);
          }
          break;
        case "repeat":
          if (mapping.trigger.code === code) {
            consumed = true;
            await this.#startRepeat(mapping);
          }
          break;
        case "swipe":
          if (mapping.trigger.code === code) {
            consumed = true;
            await this.#startSwipe(mapping);
          }
          break;
        case "joystick":
          if (Object.values(mapping.keys).includes(code)) {
            consumed = true;
            await this.#updateJoystick(mapping);
          }
          break;
        case "mouse-button":
        case "mouse-look":
          break;
      }
    }
    return consumed;
  }

  async handleKeyUp(code: string): Promise<boolean> {
    if (!this.#enabled) {
      this.#keyboard.release(code);
      return false;
    }
    const wasPressed = this.#keyboard.release(code);
    if (!wasPressed) return this.#isMappedKey(code);
    let consumed = false;
    for (const mapping of this.#activeMappings()) {
      switch (mapping.type) {
        case "hold":
          if (mapping.trigger.code === code) {
            consumed = true;
            await this.#touches.end(mapping.id);
          }
          break;
        case "repeat":
          if (mapping.trigger.code === code) {
            consumed = true;
            await this.#stopRepeat(mapping.id);
          }
          break;
        case "swipe":
          if (mapping.trigger.code === code) {
            consumed = true;
            await this.#stopSwipe(mapping.id);
          }
          break;
        case "joystick":
          if (Object.values(mapping.keys).includes(code)) {
            consumed = true;
            await this.#updateJoystick(mapping);
          }
          break;
        case "tap":
          consumed ||= mapping.trigger.code === code;
          break;
        case "mouse-button":
        case "mouse-look":
          break;
      }
    }
    return consumed;
  }

  async handleMouseDown(button: number): Promise<boolean> {
    if (!this.#enabled) return false;
    let consumed = false;
    for (const mapping of this.#activeMappings()) {
      if (mapping.type !== "mouse-button" || mapping.button !== button) continue;
      consumed = true;
      if (mapping.behavior === "tap") {
        await this.#startMouseTap(mapping.id, mapping.position, mapping.durationMs);
      } else {
        await this.#touches.begin(mapping.id, mapping.position);
      }
    }
    return consumed;
  }

  async handleMouseUp(button: number): Promise<boolean> {
    if (!this.#enabled) return false;
    let consumed = false;
    for (const mapping of this.#activeMappings()) {
      if (mapping.type !== "mouse-button" || mapping.button !== button) continue;
      consumed = true;
      if (mapping.behavior === "hold") {
        await this.#touches.end(mapping.id);
      }
    }
    return consumed;
  }

  async setPointerLockActive(active: boolean): Promise<void> {
    await this.#configurationQueue.run(async () => {
      this.#pointerLockActive = active && this.#enabled;
      if (this.#pointerLockActive) {
        await this.#beginMouseLookTouches();
        return;
      }
      this.#lookGeneration += 1;
      const lookPumps = [...this.#lookPumps.values()];
      await Promise.allSettled(lookPumps);
      this.#lookPumps.clear();
      this.#pendingLookDeltas.clear();
      for (const mapping of this.#activeMappings()) {
        if (mapping.type !== "mouse-look") continue;
        this.#lookPositions.delete(mapping.id);
        await this.#touches.end(mapping.id);
      }
    });
  }

  async handleMouseMove(
    movementX: number,
    movementY: number,
    viewportWidth: number,
    viewportHeight: number,
  ): Promise<boolean> {
    if (!this.#enabled || !this.#pointerLockActive) return false;
    let consumed = false;
    const pumps: Promise<void>[] = [];
    for (const mapping of this.#activeMappings()) {
      if (mapping.type !== "mouse-look") continue;
      consumed = true;
      const sensitivity =
        mapping.sensitivity || this.#profile.settings.mouseSensitivity;
      const radii = this.#mappingRadii(mapping.radius);
      const dx =
        (movementX / Math.max(1, viewportWidth)) *
        sensitivity *
        1000 *
        (mapping.invertX ? -1 : 1);
      const dy =
        (movementY / Math.max(1, viewportHeight)) *
        sensitivity *
        1000 *
        (mapping.invertY ? -1 : 1);

      const pending = this.#pendingLookDeltas.get(mapping.id) ?? { dx: 0, dy: 0 };
      pending.dx += dx;
      pending.dy += dy;
      this.#pendingLookDeltas.set(mapping.id, pending);

      const pump = this.#triggerLookPump(mapping, radii);
      pumps.push(pump);
    }
    await Promise.all(pumps);
    return consumed;
  }

  #triggerLookPump(
    mapping: MouseLookMapping,
    radii: { x: number; y: number },
  ): Promise<void> {
    const existing = this.#lookPumps.get(mapping.id);
    if (existing) return existing;

    const generation = this.#lookGeneration;
    let pumpPromise: Promise<void> | undefined;
    const runPump = async () => {
      try {
        while (
          generation === this.#lookGeneration &&
          this.#enabled &&
          this.#pointerLockActive
        ) {
          const pending = this.#pendingLookDeltas.get(mapping.id);
          if (
            !pending ||
            (Math.abs(pending.dx) < 1e-9 && Math.abs(pending.dy) < 1e-9)
          ) {
            break;
          }
          const delta = { x: pending.dx, y: pending.dy };
          pending.dx = 0;
          pending.dy = 0;

          const current =
            this.#lookPositions.get(mapping.id) ?? mapping.position;
          await this.#moveMouseLook(
            mapping.id,
            mapping.position,
            current,
            delta,
            radii,
            generation,
          );
        }
      } finally {
        if (this.#lookPumps.get(mapping.id) === pumpPromise) {
          this.#lookPumps.delete(mapping.id);
        }
      }
    };
    pumpPromise = runPump();
    this.#lookPumps.set(mapping.id, pumpPromise);
    return pumpPromise;
  }

  async releaseAll(): Promise<void> {
    await this.#configurationQueue.run(() => this.#releaseInputState(true));
  }

  async #releaseInputState(resetPointerLock: boolean): Promise<void> {
    this.#inputGeneration += 1;
    this.#lookGeneration += 1;
    for (const id of this.#tapTimers.values()) this.#scheduler.clearTimeout(id);
    this.#tapTimers.clear();
    for (const state of this.#repeats.values()) {
      this.#scheduler.clearInterval(state.intervalId);
      if (state.releaseId !== undefined) this.#scheduler.clearTimeout(state.releaseId);
    }
    this.#repeats.clear();
    for (const state of this.#swipes.values()) {
      if (state.frameId !== undefined) this.#scheduler.cancelFrame(state.frameId);
    }
    this.#swipes.clear();
    for (const state of this.#joysticks.values()) {
      if (state.frameId !== undefined) this.#scheduler.cancelFrame(state.frameId);
    }
    this.#joysticks.clear();
    for (const id of this.#mouseTapTimers.values()) this.#scheduler.clearTimeout(id);
    this.#mouseTapTimers.clear();
    const lookPumps = [...this.#lookPumps.values()];
    await Promise.allSettled(lookPumps);
    this.#lookPumps.clear();
    this.#pendingLookDeltas.clear();
    this.#lookPositions.clear();
    this.#keyboard.clear();
    if (resetPointerLock) this.#pointerLockActive = false;
    await this.#touches.releaseAll();
  }

  async #beginMouseLookTouches(): Promise<void> {
    for (const mapping of this.#activeMappings()) {
      if (mapping.type !== "mouse-look") continue;
      const position = { ...mapping.position };
      this.#lookPositions.set(mapping.id, position);
      await this.#touches.begin(mapping.id, position);
    }
  }

  #logEnabledState(enabled: boolean): void {
    this.#diagnostics?.info(
      "control",
      enabled ? "mappings-enabled" : "mappings-disabled",
      enabled
        ? `Game mappings enabled for “${this.#profile.name}”.`
        : "Game mappings disabled and all synthetic touches released.",
    );
  }

  #activeMappings(): GameMapping[] {
    return this.#profile.mappings.filter(
      (mapping) =>
        mapping.enabled &&
        (mapping.orientation === "any" ||
          mapping.orientation === this.#orientation),
    );
  }

  #isMappedKey(code: string): boolean {
    return this.#activeMappings().some((mapping) => {
      if (
        mapping.type === "tap" ||
        mapping.type === "hold" ||
        mapping.type === "repeat" ||
        mapping.type === "swipe"
      ) {
        return mapping.trigger.code === code;
      }
      return (
        mapping.type === "joystick" && Object.values(mapping.keys).includes(code)
      );
    });
  }

  async #startTap(
    owner: string,
    point: NormalizedPoint,
    durationMs: number,
  ): Promise<void> {
    const oldTimer = this.#tapTimers.get(owner);
    if (oldTimer !== undefined) this.#scheduler.clearTimeout(oldTimer);
    await this.#touches.begin(owner, point);
    const timer = this.#scheduler.setTimeout(() => {
      this.#tapTimers.delete(owner);
      void this.#touches.end(owner);
    }, durationMs);
    this.#tapTimers.set(owner, timer);
  }

  async #startMouseTap(
    owner: string,
    point: NormalizedPoint,
    durationMs: number,
  ): Promise<void> {
    const oldTimer = this.#mouseTapTimers.get(owner);
    if (oldTimer !== undefined) this.#scheduler.clearTimeout(oldTimer);
    await this.#touches.begin(owner, point);
    const timer = this.#scheduler.setTimeout(() => {
      this.#mouseTapTimers.delete(owner);
      void this.#touches.end(owner);
    }, durationMs);
    this.#mouseTapTimers.set(owner, timer);
  }

  async #startRepeat(mapping: RepeatMapping): Promise<void> {
    if (this.#repeats.has(mapping.id)) return;
    const generation = this.#inputGeneration;
    const pulse = async () => {
      if (
        generation !== this.#inputGeneration ||
        !this.#enabled ||
        !this.#repeats.has(mapping.id)
      ) {
        return;
      }
      if (this.#touches.has(mapping.id)) await this.#touches.end(mapping.id);
      if (
        generation !== this.#inputGeneration ||
        !this.#enabled ||
        !this.#repeats.has(mapping.id)
      ) {
        return;
      }
      await this.#touches.begin(mapping.id, mapping.position);
      const state = this.#repeats.get(mapping.id);
      if (
        !state ||
        generation !== this.#inputGeneration ||
        !this.#enabled
      ) {
        await this.#touches.end(mapping.id);
        return;
      }
      if (state.releaseId !== undefined) {
        this.#scheduler.clearTimeout(state.releaseId);
      }
      state.releaseId = this.#scheduler.setTimeout(() => {
        void this.#touches.end(mapping.id);
      }, mapping.pressMs);
    };
    const intervalId = this.#scheduler.setInterval(() => void pulse(), mapping.intervalMs);
    this.#repeats.set(mapping.id, { intervalId });
    await pulse();
  }

  async #stopRepeat(owner: string): Promise<void> {
    const state = this.#repeats.get(owner);
    if (state) {
      this.#scheduler.clearInterval(state.intervalId);
      if (state.releaseId !== undefined) this.#scheduler.clearTimeout(state.releaseId);
      this.#repeats.delete(owner);
    }
    await this.#touches.end(owner);
  }

  async #startSwipe(mapping: SwipeMapping): Promise<void> {
    const generation = this.#inputGeneration;
    await this.#stopSwipe(mapping.id);
    if (generation !== this.#inputGeneration || !this.#enabled) return;
    await this.#touches.begin(mapping.id, mapping.position);
    if (generation !== this.#inputGeneration || !this.#enabled) {
      await this.#touches.end(mapping.id);
      return;
    }
    const state: SwipeState = {
      startedAt: this.#scheduler.now(),
      released: false,
    };
    const frame = (time: number) => {
      if (
        state.released ||
        generation !== this.#inputGeneration ||
        !this.#enabled
      ) {
        return;
      }
      const progress = clamp((time - state.startedAt) / mapping.durationMs);
      const point = {
        x: mapping.position.x + (mapping.end.x - mapping.position.x) * progress,
        y: mapping.position.y + (mapping.end.y - mapping.position.y) * progress,
      };
      void this.#touches.move(mapping.id, point);
      if (progress >= 1) {
        if (mapping.releaseOnComplete) {
          state.released = true;
          this.#swipes.delete(mapping.id);
          void this.#touches.end(mapping.id);
        }
        return;
      }
      state.frameId = this.#scheduler.requestFrame(frame);
    };
    state.frameId = this.#scheduler.requestFrame(frame);
    this.#swipes.set(mapping.id, state);
  }

  async #stopSwipe(owner: string): Promise<void> {
    const state = this.#swipes.get(owner);
    if (state) {
      state.released = true;
      if (state.frameId !== undefined) this.#scheduler.cancelFrame(state.frameId);
      this.#swipes.delete(owner);
    }
    await this.#touches.end(owner);
  }

  async #updateJoystick(mapping: JoystickMapping): Promise<void> {
    const target = joystickVector(this.#keyboard.snapshot(), mapping.keys);
    let state = this.#joysticks.get(mapping.id);
    if (target.magnitude === 0) {
      if (state?.frameId !== undefined) this.#scheduler.cancelFrame(state.frameId);
      this.#joysticks.delete(mapping.id);
      await this.#touches.end(mapping.id);
      return;
    }
    if (!state) {
      state = { current: { x: 0, y: 0, magnitude: 0 } };
      this.#joysticks.set(mapping.id, state);
      await this.#touches.begin(mapping.id, mapping.position);
    }
    if (state.frameId !== undefined) this.#scheduler.cancelFrame(state.frameId);
    const animate = () => {
      const currentTarget = joystickVector(this.#keyboard.snapshot(), mapping.keys);
      const currentState = this.#joysticks.get(mapping.id);
      if (!currentState || currentTarget.magnitude === 0) {
        this.#joysticks.delete(mapping.id);
        void this.#touches.end(mapping.id);
        return;
      }
      currentState.current = smoothVector(
        currentState.current,
        currentTarget,
        mapping.smoothing === 0 ? 1 : mapping.smoothing,
      );
      void this.#touches.move(
        mapping.id,
        joystickPoint(
          mapping.position,
          this.#mappingRadii(mapping.radius),
          currentState.current,
        ),
      );
      const delta = Math.hypot(
        currentState.current.x - currentTarget.x,
        currentState.current.y - currentTarget.y,
      );
      if (delta > 0.002) {
        currentState.frameId = this.#scheduler.requestFrame(animate);
      } else {
        currentState.current = currentTarget;
        currentState.frameId = undefined;
      }
    };
    state.frameId = this.#scheduler.requestFrame(animate);
  }

  #mappingRadii(radius: number): { x: number; y: number } {
    const size = this.#getVideoSize();
    if (size.width <= 0 || size.height <= 0) return { x: radius, y: radius };
    const shortest = Math.min(size.width, size.height);
    return {
      x: (radius * shortest) / size.width,
      y: (radius * shortest) / size.height,
    };
  }

  /**
   * A touch-only camera mapping cannot be truly unbounded because Android
   * requires absolute contact coordinates. Pointer Lock supplies continuous
   * browser deltas; when the synthetic contact reaches its ellipse boundary,
   * finish that swipe, immediately start a new contact at the configured
   * center, and continue with the unconsumed delta in the same task.
   */
  async #moveMouseLook(
    owner: string,
    center: NormalizedPoint,
    initial: NormalizedPoint,
    delta: NormalizedPoint,
    requestedRadii: { x: number; y: number },
    generation: number,
  ): Promise<void> {
    const radii = {
      x: Math.max(
        0.000_001,
        Math.min(requestedRadii.x, center.x, 1 - center.x),
      ),
      y: Math.max(
        0.000_001,
        Math.min(requestedRadii.y, center.y, 1 - center.y),
      ),
    };
    let current = initial;
    let remaining = delta;
    let segment = 0;

    while (true) {
      if (
        generation !== this.#lookGeneration ||
        !this.#enabled ||
        !this.#pointerLockActive
      ) {
        return;
      }
      if (Math.abs(remaining.x) < 1e-9 && Math.abs(remaining.y) < 1e-9) {
        this.#lookPositions.set(owner, current);
        return;
      }
      const target = {
        x: current.x + remaining.x,
        y: current.y + remaining.y,
      };
      const targetNorm =
        ((target.x - center.x) / radii.x) ** 2 +
        ((target.y - center.y) / radii.y) ** 2;
      if (targetNorm <= 1 + 1e-9) {
        const next = {
          x: clamp(target.x),
          y: clamp(target.y),
        };
        await this.#touches.move(owner, next);
        this.#lookPositions.set(owner, next);
        return;
      }

      const originX = (current.x - center.x) / radii.x;
      const originY = (current.y - center.y) / radii.y;
      const vectorX = remaining.x / radii.x;
      const vectorY = remaining.y / radii.y;
      const a = vectorX ** 2 + vectorY ** 2;
      const b = 2 * (originX * vectorX + originY * vectorY);
      const c = originX ** 2 + originY ** 2 - 1;
      const discriminant = Math.max(0, b ** 2 - 4 * a * c);
      const boundaryFraction =
        a <= 1e-12
          ? 1
          : clamp((-b + Math.sqrt(discriminant)) / (2 * a));
      const consumed = Math.max(0, Math.min(1, boundaryFraction));

      if (consumed > 1e-9) {
        const boundary = {
          x: clamp(current.x + remaining.x * consumed),
          y: clamp(current.y + remaining.y * consumed),
        };
        await this.#touches.move(owner, boundary);
      }
      remaining = {
        x: remaining.x * (1 - consumed),
        y: remaining.y * (1 - consumed),
      };
      await this.#touches.end(owner);
      if (generation !== this.#lookGeneration) return;
      await this.#touches.begin(owner, center);
      current = center;
      segment += 1;
      if (segment % 128 === 0) {
        // Imported profiles or synthetic events can report extreme deltas.
        // Yield without dropping the remainder so the UI stays responsive.
        await new Promise<void>((resolve) => {
          this.#scheduler.setTimeout(resolve, 0);
        });
      }
    }
  }
}
