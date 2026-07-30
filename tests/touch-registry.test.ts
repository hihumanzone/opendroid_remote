import { describe, expect, it } from "vitest";

import {
  TouchRegistry,
  type SyntheticTouchEvent,
} from "../src/input/TouchRegistry";

describe("multi-touch lifecycle", () => {
  it("keeps simultaneous touches independent through DOWN/MOVE/UP", async () => {
    const events: SyntheticTouchEvent[] = [];
    const touches = new TouchRegistry({
      touch(event) {
        events.push(structuredClone(event));
      },
    });

    const left = await touches.begin("left-stick", { x: 0.2, y: 0.8 });
    const fire = await touches.begin("fire", { x: 0.9, y: 0.5 });
    expect(left).not.toBe(fire);
    expect(touches.active).toHaveLength(2);

    await touches.move("left-stick", { x: -1, y: 2 });
    await touches.end("fire");
    expect(touches.active).toHaveLength(1);
    expect(events.map((event) => event.phase)).toEqual([
      "down",
      "down",
      "move",
      "up",
    ]);
    expect(events[2]!.point).toEqual({ x: 0, y: 1 });
    expect(events[3]!.pointerId).toBe(fire);
  });

  it("releases every active pointer on pause", async () => {
    const events: SyntheticTouchEvent[] = [];
    const touches = new TouchRegistry({
      touch(event) {
        events.push(structuredClone(event));
      },
    });
    await touches.begin("one", { x: 0.1, y: 0.1 });
    await touches.begin("two", { x: 0.9, y: 0.9 });
    await touches.releaseAll();
    expect(touches.active).toHaveLength(0);
    expect(events.slice(-2).map((event) => event.phase)).toEqual(["up", "up"]);
    expect(new Set(events.slice(-2).map((event) => event.pointerId)).size).toBe(2);
  });

  it("rolls back allocation when a DOWN write fails", async () => {
    let fail = true;
    const touches = new TouchRegistry({
      touch() {
        if (fail) throw new Error("transport closed");
      },
    });
    await expect(touches.begin("one", { x: 0.5, y: 0.5 })).rejects.toThrow(
      "transport closed",
    );
    expect(touches.active).toHaveLength(0);
    fail = false;
    expect(await touches.begin("two", { x: 0.5, y: 0.5 })).toBe(1n);
  });
});
