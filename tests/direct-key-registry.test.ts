import { describe, expect, it } from "vitest";

import { DirectKeyRegistry } from "../src/input/DirectKeyRegistry";

describe("DirectKeyRegistry", () => {
  it("keeps the first key-down identity across repeats", () => {
    const registry = new DirectKeyRegistry();
    const first = registry.press({
      domCode: "KeyW",
      androidCode: 51,
      metaState: 1,
    });
    const repeated = registry.press({
      domCode: "KeyW",
      androidCode: 99,
      metaState: 2,
    });

    expect(repeated).toEqual(first);
    expect(registry.size).toBe(1);
    expect(registry.release("KeyW")).toEqual(first);
    expect(registry.size).toBe(0);
  });

  it("atomically drains every held Android key for cleanup", () => {
    const registry = new DirectKeyRegistry();
    registry.press({ domCode: "KeyA", androidCode: 29, metaState: 0 });
    registry.press({ domCode: "ShiftLeft", androidCode: 59, metaState: 1 });

    expect(registry.releaseAll().map((key) => key.domCode)).toEqual([
      "KeyA",
      "ShiftLeft",
    ]);
    expect(registry.releaseAll()).toEqual([]);
  });
});
