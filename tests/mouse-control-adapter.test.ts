import {
  AndroidMotionEventAction,
  ScrcpyPointerId,
  type ScrcpyControlMessageWriter,
} from "@yume-chan/scrcpy";
import { describe, expect, it, vi } from "vitest";

import { Diagnostics } from "../src/debug/Diagnostics";
import { ScrcpyControlAdapter } from "../src/scrcpy/ScrcpyControlAdapter";

describe("Android SDK mouse compatibility path", () => {
  it("uses mouse hover and click MotionEvents instead of finger pointers", async () => {
    const injectTouch = vi.fn(async () => {});
    const controller = {
      injectTouch,
      injectScroll: vi.fn(async () => {}),
    } as unknown as ScrcpyControlMessageWriter;
    const adapter = new ScrcpyControlAdapter(
      controller,
      () => ({ width: 1000, height: 500 }),
      new Diagnostics(),
      "sdk",
    );

    await adapter.mouseMove({ x: 0.25, y: 0.75 }, 0);
    expect(injectTouch).toHaveBeenLastCalledWith(
      expect.objectContaining({
        action: AndroidMotionEventAction.HoverMove,
        pointerId: ScrcpyPointerId.Mouse,
        pointerX: 250,
        pointerY: 374,
        pressure: 1,
        buttons: 0,
      }),
    );

    await adapter.mouseButton({ x: 0.25, y: 0.75 }, 2, true, 2);
    expect(injectTouch).toHaveBeenLastCalledWith(
      expect.objectContaining({
        action: AndroidMotionEventAction.Down,
        pointerId: ScrcpyPointerId.Mouse,
        actionButton: 2,
        buttons: 2,
      }),
    );

    await adapter.mouseMove({ x: 0.3, y: 0.8 }, 2);
    expect(injectTouch).toHaveBeenLastCalledWith(
      expect.objectContaining({
        action: AndroidMotionEventAction.Move,
        pointerId: ScrcpyPointerId.Mouse,
        buttons: 2,
      }),
    );
  });

  it("never converts direct mouse input when the mode is disabled", async () => {
    const injectTouch = vi.fn(async () => {});
    const injectScroll = vi.fn(async () => {});
    const controller = {
      injectTouch,
      injectScroll,
    } as unknown as ScrcpyControlMessageWriter;
    const adapter = new ScrcpyControlAdapter(
      controller,
      () => ({ width: 1000, height: 500 }),
      new Diagnostics(),
      "disabled",
    );

    await adapter.mouseMove({ x: 0.25, y: 0.75 }, 0);
    await adapter.mouseMoveRelative(20, -10);
    await adapter.mouseButton({ x: 0.25, y: 0.75 }, 0, true, 1);
    await adapter.scroll({ x: 0.25, y: 0.75 }, 0, -1);

    expect(injectTouch).not.toHaveBeenCalled();
    expect(injectScroll).not.toHaveBeenCalled();
  });

  it("tracks and releases every SDK mouse button after focus loss", async () => {
    const injectTouch = vi.fn<(message: unknown) => Promise<void>>(
      async () => {},
    );
    const controller = {
      injectTouch,
      injectScroll: vi.fn(async () => {}),
    } as unknown as ScrcpyControlMessageWriter;
    const adapter = new ScrcpyControlAdapter(
      controller,
      () => ({ width: 1000, height: 500 }),
      new Diagnostics(),
      "sdk",
    );

    await adapter.mouseButton({ x: 0.4, y: 0.6 }, 0, true, 1);
    await adapter.mouseButton({ x: 0.4, y: 0.6 }, 2, true, 3);
    await adapter.mouseMove({ x: 0.7, y: 0.2 }, 31);
    await adapter.releaseMouseButtons();

    const calls = injectTouch.mock.calls.map(([message]) => message);
    expect(calls.at(-3)).toEqual(
      expect.objectContaining({
        action: AndroidMotionEventAction.Move,
        buttons: 3,
      }),
    );
    expect(calls.at(-2)).toEqual(
      expect.objectContaining({
        action: AndroidMotionEventAction.Up,
        actionButton: 2,
        buttons: 1,
      }),
    );
    expect(calls.at(-1)).toEqual(
      expect.objectContaining({
        action: AndroidMotionEventAction.Up,
        actionButton: 1,
        buttons: 0,
      }),
    );

    await adapter.releaseMouseButtons();
    expect(injectTouch).toHaveBeenCalledTimes(5);
  });

  it("automatically releases stuck SDK buttons and reverts to hover when mouseMove reports buttons=0", async () => {
    const injectTouch = vi.fn<(message: unknown) => Promise<void>>(
      async () => {},
    );
    const controller = {
      injectTouch,
      injectScroll: vi.fn(async () => {}),
    } as unknown as ScrcpyControlMessageWriter;
    const adapter = new ScrcpyControlAdapter(
      controller,
      () => ({ width: 1000, height: 500 }),
      new Diagnostics(),
      "sdk",
    );

    // 1. Click and hold primary button
    await adapter.mouseButton({ x: 0.5, y: 0.5 }, 0, true, 1);
    expect(injectTouch).toHaveBeenLastCalledWith(
      expect.objectContaining({
        action: AndroidMotionEventAction.Down,
        actionButton: 1,
        buttons: 1,
      }),
    );

    // 2. Drag to scroll
    await adapter.mouseMove({ x: 0.5, y: 0.3 }, 1);
    expect(injectTouch).toHaveBeenLastCalledWith(
      expect.objectContaining({
        action: AndroidMotionEventAction.Move,
        buttons: 1,
      }),
    );

    // 3. User releases button outside and moves cursor back into screen (buttons = 0)
    await adapter.mouseMove({ x: 0.5, y: 0.4 }, 0);

    const calls = injectTouch.mock.calls.map(([message]) => message);
    expect(calls.at(-2)).toEqual(
      expect.objectContaining({
        action: AndroidMotionEventAction.Up,
        actionButton: 1,
        buttons: 0,
      }),
    );
    expect(calls.at(-1)).toEqual(
      expect.objectContaining({
        action: AndroidMotionEventAction.HoverMove,
        buttons: 0,
      }),
    );
  });
});
