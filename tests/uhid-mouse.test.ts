import type { ScrcpyControlMessageWriter } from "@yume-chan/scrcpy";
import { describe, expect, it, vi } from "vitest";

import { Diagnostics } from "../src/debug/Diagnostics";
import { ScrcpyControlAdapter } from "../src/scrcpy/ScrcpyControlAdapter";
import {
  domButtonMask,
  UHID_MOUSE_ID,
  UHID_MOUSE_REPORT_DESCRIPTOR,
  UhidMouseDevice,
  type UhidMouseTransport,
} from "../src/scrcpy/UhidMouseDevice";

function harness(sensitivity = 1) {
  const created: Array<{ id: number; descriptor: number[] }> = [];
  const reports: number[][] = [];
  const destroyed: number[] = [];
  const transport: UhidMouseTransport = {
    async create(id, descriptor) {
      created.push({ id, descriptor: [...descriptor] });
    },
    async input(id, report) {
      expect(id).toBe(UHID_MOUSE_ID);
      reports.push([...report]);
    },
    async destroy(id) {
      destroyed.push(id);
    },
  };
  return {
    mouse: new UhidMouseDevice(transport, sensitivity),
    created,
    reports,
    destroyed,
  };
}

describe("Android UHID physical mouse", () => {
  it("registers the upstream five-button relative mouse descriptor", async () => {
    const { mouse, created } = harness();
    await mouse.open();
    await mouse.open();

    expect(created).toEqual([
      {
        id: UHID_MOUSE_ID,
        descriptor: [...UHID_MOUSE_REPORT_DESCRIPTOR],
      },
    ]);
    expect(UHID_MOUSE_REPORT_DESCRIPTOR.at(-2)).toBe(0xc0);
    expect(UHID_MOUSE_REPORT_DESCRIPTOR.at(-1)).toBe(0xc0);
  });

  it("preserves large relative deltas by splitting signed HID reports", async () => {
    const { mouse, reports } = harness();
    await mouse.open();
    await mouse.move(300, -260);

    expect(reports).toEqual([
      [0, 127, 129, 0, 0],
      [0, 127, 129, 0, 0],
      [0, 46, 250, 0, 0],
    ]);
  });

  it("retains fractional sensitivity without dropping subpixel motion", async () => {
    const { mouse, reports } = harness(0.5);
    await mouse.open();
    await mouse.move(1, -1);
    expect(reports).toEqual([]);
    await mouse.move(1, -1);
    expect(reports).toEqual([[0, 1, 255, 0, 0]]);
  });

  it("forwards left, right, middle, back, and forward button state", async () => {
    const { mouse, reports } = harness();
    await mouse.open();
    for (const button of [0, 2, 1, 3, 4]) {
      expect(await mouse.button(button, true)).toBe(true);
    }
    expect(reports.map((report) => report[0])).toEqual([1, 3, 7, 15, 31]);
    expect(domButtonMask(9)).toBe(0);
    expect(await mouse.button(9, true)).toBe(false);
  });

  it("accumulates smooth two-axis wheel input into integral HID ticks", async () => {
    const { mouse, reports } = harness();
    await mouse.open();
    await mouse.scroll(0.4, -0.4);
    expect(reports).toEqual([]);
    await mouse.scroll(0.6, -0.6);
    expect(reports).toEqual([[0, 0, 0, 255, 1]]);
  });

  it("releases held buttons before destroying the virtual device", async () => {
    const { mouse, reports, destroyed } = harness();
    await mouse.open();
    await mouse.button(0, true);
    await mouse.close();

    expect(reports.at(-1)).toEqual([0, 0, 0, 0, 0]);
    expect(destroyed).toEqual([UHID_MOUSE_ID]);
    expect(mouse.opened).toBe(false);
  });

  it("wires physical reports through scrcpy UHID control messages", async () => {
    const uHidCreate = vi.fn(async () => {});
    const uHidInput = vi.fn(async () => {});
    const uHidDestroy = vi.fn(async () => {});
    const injectTouch = vi.fn(async () => {});
    const controller = {
      uHidCreate,
      uHidInput,
      uHidDestroy,
      injectTouch,
    } as unknown as ScrcpyControlMessageWriter;
    const adapter = new ScrcpyControlAdapter(
      controller,
      () => ({ width: 1000, height: 500 }),
      new Diagnostics(),
      "uhid",
    );

    await adapter.initializeMouse();
    await adapter.mouseMoveRelative(2, -3);
    await adapter.mouseButton({ x: 0.5, y: 0.5 }, 2, true, 2);
    await adapter.scroll({ x: 0.5, y: 0.5 }, 1, -1);
    await adapter.close();

    expect(uHidCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        id: UHID_MOUSE_ID,
        data: UHID_MOUSE_REPORT_DESCRIPTOR,
      }),
    );
    expect(uHidInput).toHaveBeenCalledWith({
      id: UHID_MOUSE_ID,
      data: new Uint8Array([0, 2, 253, 0, 0]),
    });
    expect(uHidDestroy).toHaveBeenCalledWith(UHID_MOUSE_ID);
    expect(injectTouch).not.toHaveBeenCalled();
  });

  it("coalesces high-frequency mouse movements while writes are in flight without backlog", async () => {
    let unblockFirstWrite = () => {};
    let firstWriteBlocked = true;
    const reports: number[][] = [];
    const transport: UhidMouseTransport = {
      async create() {},
      async input(id, report) {
        expect(id).toBe(UHID_MOUSE_ID);
        reports.push([...report]);
        if (firstWriteBlocked) {
          firstWriteBlocked = false;
          await new Promise<void>((resolve) => {
            unblockFirstWrite = resolve;
          });
        }
      },
      async destroy() {},
    };
    const mouse = new UhidMouseDevice(transport, 1);
    await mouse.open();

    // First move starts write and is blocked
    const move1 = mouse.move(5, 5);
    // Concurrent moves arrive while first write is in flight
    const move2 = mouse.move(10, -5);
    const move3 = mouse.move(2, 3);

    // Unblock the first write
    unblockFirstWrite();
    await Promise.all([move1, move2, move3]);
    await mouse.flush();

    // First report had (5, 5). Second report has the combined delta (12, -2).
    expect(reports).toEqual([
      [0, 5, 5, 0, 0],
      [0, 12, 254, 0, 0],
    ]);
  });
});
