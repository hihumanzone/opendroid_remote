import type { NormalizedPoint } from "../core/types";
import { clamp } from "../core/types";
import { PointerIdAllocator } from "./PointerIdAllocator";

export type TouchPhase = "down" | "move" | "up" | "cancel";

export interface SyntheticTouchEvent {
  phase: TouchPhase;
  pointerId: bigint;
  point: NormalizedPoint;
  pressure: number;
  buttons: number;
}

export interface SyntheticTouchSink {
  touch(event: SyntheticTouchEvent): Promise<void> | void;
}

export interface ActiveTouch {
  owner: string;
  pointerId: bigint;
  point: NormalizedPoint;
  buttons: number;
}

function safePoint(point: NormalizedPoint): NormalizedPoint {
  return { x: clamp(point.x), y: clamp(point.y) };
}

export class TouchRegistry {
  readonly #active = new Map<string, ActiveTouch>();

  constructor(
    private readonly sink: SyntheticTouchSink,
    private readonly pointers = new PointerIdAllocator(),
  ) {}

  get active(): readonly ActiveTouch[] {
    return [...this.#active.values()].map((touch) => ({
      ...touch,
      point: { ...touch.point },
    }));
  }

  has(owner: string): boolean {
    return this.#active.has(owner);
  }

  async begin(
    owner: string,
    point: NormalizedPoint,
    buttons = 1,
  ): Promise<bigint> {
    const existing = this.#active.get(owner);
    if (existing) {
      await this.move(owner, point, buttons);
      return existing.pointerId;
    }
    const pointerId = this.pointers.allocate(owner);
    const active: ActiveTouch = {
      owner,
      pointerId,
      point: safePoint(point),
      buttons,
    };
    this.#active.set(owner, active);
    try {
      await this.sink.touch({
        phase: "down",
        pointerId,
        point: active.point,
        pressure: 1,
        buttons,
      });
      return pointerId;
    } catch (error) {
      this.#active.delete(owner);
      this.pointers.release(owner);
      throw error;
    }
  }

  async move(
    owner: string,
    point: NormalizedPoint,
    buttons?: number,
  ): Promise<void> {
    const active = this.#active.get(owner);
    if (!active) return;
    active.point = safePoint(point);
    if (buttons !== undefined) active.buttons = buttons;
    await this.sink.touch({
      phase: "move",
      pointerId: active.pointerId,
      point: active.point,
      pressure: 1,
      buttons: active.buttons,
    });
  }

  async end(owner: string): Promise<void> {
    await this.#finish(owner, "up");
  }

  async cancel(owner: string): Promise<void> {
    await this.#finish(owner, "cancel");
  }

  async releaseAll(cancel = false): Promise<void> {
    const owners = [...this.#active.keys()];
    await Promise.allSettled(
      owners.map((owner) => this.#finish(owner, cancel ? "cancel" : "up")),
    );
    this.pointers.releaseAll();
  }

  async #finish(owner: string, phase: "up" | "cancel"): Promise<void> {
    const active = this.#active.get(owner);
    if (!active) return;
    this.#active.delete(owner);
    this.pointers.release(owner);
    await this.sink.touch({
      phase,
      pointerId: active.pointerId,
      point: active.point,
      pressure: 0,
      buttons: 0,
    });
  }
}

