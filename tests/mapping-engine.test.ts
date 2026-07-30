import { describe, expect, it } from "vitest";

import {
  MappingEngine,
  type MappingScheduler,
} from "../src/input/MappingEngine";
import type { SyntheticTouchEvent } from "../src/input/TouchRegistry";
import {
  createMapping,
  createProfile,
  type GameMapping,
} from "../src/profiles/schema";

class ManualScheduler implements MappingScheduler {
  time = 0;
  nextId = 1;
  readonly timeouts = new Map<number, () => void>();
  readonly intervals = new Map<number, () => void>();
  readonly frames = new Map<number, (time: number) => void>();

  now() {
    return this.time;
  }

  setTimeout(callback: () => void) {
    const id = this.nextId++;
    this.timeouts.set(id, callback);
    return id;
  }

  clearTimeout(id: number) {
    this.timeouts.delete(id);
  }

  setInterval(callback: () => void) {
    const id = this.nextId++;
    this.intervals.set(id, callback);
    return id;
  }

  clearInterval(id: number) {
    this.intervals.delete(id);
  }

  requestFrame(callback: (time: number) => void) {
    const id = this.nextId++;
    this.frames.set(id, callback);
    return id;
  }

  cancelFrame(id: number) {
    this.frames.delete(id);
  }

  async fireTimeouts() {
    const callbacks = [...this.timeouts.values()];
    this.timeouts.clear();
    callbacks.forEach((callback) => callback());
    await Promise.resolve();
  }

  async fireIntervals() {
    [...this.intervals.values()].forEach((callback) => callback());
    await Promise.resolve();
  }

  async frame(time: number) {
    this.time = time;
    const callbacks = [...this.frames.values()];
    this.frames.clear();
    callbacks.forEach((callback) => callback(time));
    await Promise.resolve();
  }
}

function harness(mappings: GameMapping[]) {
  const events: SyntheticTouchEvent[] = [];
  const scheduler = new ManualScheduler();
  const profile = createProfile("Test");
  profile.mappings = mappings;
  const engine = new MappingEngine(
    {
      touch(event) {
        events.push(structuredClone(event));
      },
    },
    profile,
    {
      scheduler,
      getVideoSize: () => ({ width: 2400, height: 1080 }),
    },
  );
  return { engine, events, scheduler };
}

describe("mapping execution", () => {
  it("executes simultaneous key holds with independent pointer IDs", async () => {
    const first = createMapping("hold", { x: 0.2, y: 0.8 });
    first.trigger.code = "KeyF";
    const second = createMapping("hold", { x: 0.8, y: 0.3 });
    second.trigger.code = "KeyG";
    const { engine, events } = harness([first, second]);
    await engine.setEnabled(true);
    await engine.handleKeyDown("KeyF");
    await engine.handleKeyDown("KeyG");
    expect(events.map((event) => event.phase)).toEqual(["down", "down"]);
    expect(events[0]!.pointerId).not.toBe(events[1]!.pointerId);
    expect(engine.activeTouchCount).toBe(2);
    await engine.handleKeyUp("KeyF");
    expect(engine.activeTouchCount).toBe(1);
    await engine.handleKeyUp("KeyG");
    expect(engine.activeTouchCount).toBe(0);
  });

  it("releases a timed tap and emits repeat pulses", async () => {
    const tap = createMapping("tap");
    tap.trigger.code = "Space";
    const repeat = createMapping("repeat");
    repeat.trigger.code = "KeyR";
    const { engine, events, scheduler } = harness([tap, repeat]);
    await engine.setEnabled(true);
    await engine.handleKeyDown("Space");
    await scheduler.fireTimeouts();
    expect(events.slice(0, 2).map((event) => event.phase)).toEqual(["down", "up"]);
    await engine.handleKeyDown("KeyR");
    await scheduler.fireTimeouts();
    await scheduler.fireIntervals();
    expect(events.filter((event) => event.phase === "down").length).toBe(3);
    await engine.handleKeyUp("KeyR");
    expect(engine.activeTouchCount).toBe(0);
  });

  it("animates a swipe to the configured endpoint", async () => {
    const swipe = createMapping("swipe", { x: 0.1, y: 0.2 });
    swipe.end = { x: 0.9, y: 0.8 };
    swipe.durationMs = 100;
    const { engine, events, scheduler } = harness([swipe]);
    await engine.setEnabled(true);
    await engine.handleKeyDown(swipe.trigger.code);
    await scheduler.frame(50);
    await scheduler.frame(100);
    expect(events.map((event) => event.phase)).toEqual([
      "down",
      "move",
      "move",
      "up",
    ]);
    expect(events[1]!.point).toEqual({ x: 0.5, y: 0.5 });
    expect(events[2]!.point).toEqual(swipe.end);
  });

  it("moves a WASD joystick diagonally and releases on the last key-up", async () => {
    const joystick = createMapping("joystick", { x: 0.2, y: 0.8 });
    joystick.smoothing = 0;
    const { engine, events, scheduler } = harness([joystick]);
    await engine.setEnabled(true);
    await engine.handleKeyDown("KeyW");
    await scheduler.frame(16);
    await engine.handleKeyDown("KeyD");
    await scheduler.frame(32);
    const lastMove = events.filter((event) => event.phase === "move").at(-1)!;
    expect(lastMove.point.x).toBeGreaterThan(joystick.position.x);
    expect(lastMove.point.y).toBeLessThan(joystick.position.y);
    await engine.handleKeyUp("KeyW");
    await scheduler.frame(48);
    expect(engine.activeTouchCount).toBe(1);
    await engine.handleKeyUp("KeyD");
    expect(engine.activeTouchCount).toBe(0);
    expect(events.at(-1)!.phase).toBe("up");
  });

  it("uses Pointer Lock movement for mouse-look and releases on unlock", async () => {
    const look = createMapping("mouse-look", { x: 0.5, y: 0.5 });
    const { engine, events } = harness([look]);
    await engine.setEnabled(true);
    await engine.setPointerLockActive(true);
    expect(events.at(-1)!.phase).toBe("down");
    await engine.handleMouseMove(25, -10, 1000, 500);
    expect(events.at(-1)!.phase).toBe("move");
    expect(events.at(-1)!.point.x).toBeGreaterThan(0.5);
    expect(events.at(-1)!.point.y).toBeLessThan(0.5);
    await engine.setPointerLockActive(false);
    expect(events.at(-1)!.phase).toBe("up");
  });

  it("recenters touch mouse-look and preserves continuous locked movement", async () => {
    const look = createMapping("mouse-look", { x: 0.5, y: 0.5 });
    look.radius = 0.05;
    look.sensitivity = 0.01;
    const { engine, events } = harness([look]);
    await engine.setEnabled(true);
    await engine.setPointerLockActive(true);

    await engine.handleMouseMove(20, 0, 1000, 500);
    const firstGestureCount = events.filter(
      (event) => event.phase === "down",
    ).length;
    expect(firstGestureCount).toBeGreaterThan(1);
    expect(
      events
        .filter((event) => event.phase === "move")
        .every((event) => event.point.x >= look.position.x),
    ).toBe(true);

    await engine.handleMouseMove(20, 0, 1000, 500);
    expect(
      events.filter((event) => event.phase === "down").length,
    ).toBeGreaterThan(firstGestureCount);
    expect(engine.activeTouchCount).toBe(1);

    await engine.setPointerLockActive(false);
    expect(engine.activeTouchCount).toBe(0);
  });

  it("serializes concurrent mouse-look deltas without overwriting position", async () => {
    const events: SyntheticTouchEvent[] = [];
    let releaseFirstMove = () => {};
    let holdFirstMove = true;
    const look = createMapping("mouse-look", { x: 0.5, y: 0.5 });
    look.sensitivity = 0.001;
    const profile = createProfile("Queued look");
    profile.mappings = [look];
    const engine = new MappingEngine(
      {
        touch(event) {
          events.push(structuredClone(event));
          if (event.phase === "move" && holdFirstMove) {
            holdFirstMove = false;
            return new Promise<void>((resolve) => {
              releaseFirstMove = resolve;
            });
          }
        },
      },
      profile,
      { getVideoSize: () => ({ width: 1000, height: 500 }) },
    );
    await engine.setEnabled(true);
    await engine.setPointerLockActive(true);

    const first = engine.handleMouseMove(1, 0, 1000, 500);
    await Promise.resolve();
    const second = engine.handleMouseMove(1, 0, 1000, 500);
    await Promise.resolve();
    expect(events.filter((event) => event.phase === "move")).toHaveLength(1);

    releaseFirstMove();
    await Promise.all([first, second]);
    const moves = events.filter((event) => event.phase === "move");
    expect(moves).toHaveLength(2);
    expect(moves[1]!.point.x).toBeGreaterThan(moves[0]!.point.x);
  });

  it("coalesces profile changes and re-arms an existing Pointer Lock session", async () => {
    const events: SyntheticTouchEvent[] = [];
    let releaseOldTouch = () => {};
    let holdFirstUp = true;
    let signalOldTouch = () => {};
    const oldTouchStarted = new Promise<void>((resolve) => {
      signalOldTouch = resolve;
    });
    const firstLook = createMapping("mouse-look", { x: 0.4, y: 0.4 });
    const initial = createProfile("Initial");
    initial.mappings = [firstLook];
    const engine = new MappingEngine(
      {
        touch(event) {
          events.push(structuredClone(event));
          if (event.phase === "up" && holdFirstUp) {
            holdFirstUp = false;
            signalOldTouch();
            return new Promise<void>((resolve) => {
              releaseOldTouch = resolve;
            });
          }
        },
      },
      initial,
      { getVideoSize: () => ({ width: 1000, height: 500 }) },
    );
    await engine.setEnabled(true);
    await engine.setPointerLockActive(true);

    const superseded = createProfile("Superseded");
    superseded.mappings = [
      createMapping("mouse-look", { x: 0.6, y: 0.4 }),
    ];
    const final = createProfile("Final");
    final.mappings = [
      createMapping("mouse-look", { x: 0.7, y: 0.5 }),
    ];
    const firstUpdate = engine.configure(superseded, "landscape", true);
    await oldTouchStarted;
    const finalUpdate = engine.configure(final, "landscape", true);
    releaseOldTouch();
    await Promise.all([firstUpdate, finalUpdate]);

    expect(engine.profile.id).toBe(final.id);
    expect(engine.enabled).toBe(true);
    expect(engine.activeTouchCount).toBe(1);
    expect(events.map((event) => event.phase)).toEqual([
      "down",
      "up",
      "down",
    ]);
    expect(events.at(-1)!.point).toEqual({ x: 0.7, y: 0.5 });

    await engine.handleMouseMove(2, 0, 1000, 500);
    expect(events.at(-1)!.phase).toBe("move");
    expect(events.at(-1)!.point.x).toBeGreaterThan(0.7);
  });

  it("emergency-stops mappings and immediately releases every touch", async () => {
    const hold = createMapping("hold");
    hold.trigger.code = "KeyF";
    const fire = createMapping("mouse-button");
    const { engine, events } = harness([hold, fire]);
    await engine.setEnabled(true);
    await engine.handleKeyDown("KeyF");
    await engine.handleMouseDown(0);
    expect(engine.activeTouchCount).toBe(2);
    expect(await engine.handleKeyDown("Escape")).toBe(true);
    expect(engine.enabled).toBe(false);
    expect(engine.activeTouchCount).toBe(0);
    expect(events.slice(-2).every((event) => event.phase === "up")).toBe(true);
  });

  it("does not recreate a repeat touch while cleanup is in flight", async () => {
    const events: SyntheticTouchEvent[] = [];
    const scheduler = new ManualScheduler();
    const repeat = createMapping("repeat");
    const profile = createProfile("Repeat cleanup");
    profile.mappings = [repeat];
    let releasePulse = () => {};
    let signalPulse = () => {};
    const pulseStarted = new Promise<void>((resolve) => {
      signalPulse = resolve;
    });
    let blockNextUp = true;
    const engine = new MappingEngine(
      {
        touch(event) {
          events.push(structuredClone(event));
          if (event.phase === "up" && blockNextUp) {
            blockNextUp = false;
            signalPulse();
            return new Promise<void>((resolve) => {
              releasePulse = resolve;
            });
          }
        },
      },
      profile,
      { scheduler },
    );
    await engine.setEnabled(true);
    await engine.handleKeyDown(repeat.trigger.code);
    const interval = [...scheduler.intervals.values()][0]!;
    interval();
    await pulseStarted;

    const cleanup = engine.releaseAll();
    await Promise.resolve();
    releasePulse();
    await cleanup;
    await Promise.resolve();

    expect(engine.activeTouchCount).toBe(0);
    expect(events.map((event) => event.phase)).toEqual(["down", "up"]);
  });

  it("filters mappings by current orientation", async () => {
    const portrait = createMapping("hold");
    portrait.orientation = "portrait";
    portrait.trigger.code = "KeyP";
    const { engine, events } = harness([portrait]);
    await engine.setEnabled(true);
    expect(await engine.handleKeyDown("KeyP")).toBe(false);
    await engine.setOrientation("portrait");
    expect(await engine.handleKeyDown("KeyP")).toBe(true);
    expect(events.at(-1)!.phase).toBe("down");
  });
});
