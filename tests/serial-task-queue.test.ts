import { describe, expect, it } from "vitest";

import {
  QueueClosedError,
  SerialTaskQueue,
} from "../src/core/SerialTaskQueue";

describe("SerialTaskQueue", () => {
  it("runs async lifecycle mutations strictly in request order", async () => {
    const queue = new SerialTaskQueue();
    const events: string[] = [];
    let releaseFirst = () => {};

    const first = queue.run(async () => {
      events.push("first:start");
      await new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      events.push("first:end");
      return 1;
    });
    const second = queue.run(async () => {
      events.push("second");
      return 2;
    });

    await Promise.resolve();
    expect(events).toEqual(["first:start"]);
    releaseFirst();
    await expect(Promise.all([first, second])).resolves.toEqual([1, 2]);
    expect(events).toEqual(["first:start", "first:end", "second"]);
  });

  it("continues after a task fails and rejects work after close", async () => {
    const queue = new SerialTaskQueue();
    await expect(
      queue.run(() => {
        throw new Error("failed");
      }),
    ).rejects.toThrow("failed");
    await expect(queue.run(() => "next")).resolves.toBe("next");
    queue.close();
    await expect(queue.run(() => "late")).rejects.toBeInstanceOf(
      QueueClosedError,
    );
  });
});
