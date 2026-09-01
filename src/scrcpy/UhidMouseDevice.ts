/**
 * Relative five-button mouse descriptor used by upstream scrcpy 3.3.3.
 *
 * Source:
 * https://github.com/Genymobile/scrcpy/blob/v3.3.3/app/src/hid/hid_mouse.c
 *
 * Report layout: buttons, X, Y, vertical wheel, horizontal wheel. Motion and
 * wheel axes are signed relative 8-bit values in the range -127..127.
 */
export const UHID_MOUSE_REPORT_DESCRIPTOR = new Uint8Array([
  0x05, 0x01, // Usage Page (Generic Desktop)
  0x09, 0x02, // Usage (Mouse)
  0xa1, 0x01, // Collection (Application)
  0x09, 0x01, // Usage (Pointer)
  0xa1, 0x00, // Collection (Physical)
  0x05, 0x09, // Usage Page (Buttons)
  0x19, 0x01, // Usage Minimum (1)
  0x29, 0x05, // Usage Maximum (5)
  0x15, 0x00, // Logical Minimum (0)
  0x25, 0x01, // Logical Maximum (1)
  0x95, 0x05, // Report Count (5)
  0x75, 0x01, // Report Size (1)
  0x81, 0x02, // Input (Data, Variable, Absolute)
  0x95, 0x01, // Report Count (1)
  0x75, 0x03, // Report Size (3)
  0x81, 0x01, // Input (Constant)
  0x05, 0x01, // Usage Page (Generic Desktop)
  0x09, 0x30, // Usage (X)
  0x09, 0x31, // Usage (Y)
  0x09, 0x38, // Usage (Wheel)
  0x15, 0x81, // Logical Minimum (-127)
  0x25, 0x7f, // Logical Maximum (127)
  0x75, 0x08, // Report Size (8)
  0x95, 0x03, // Report Count (3)
  0x81, 0x06, // Input (Data, Variable, Relative)
  0x05, 0x0c, // Usage Page (Consumer)
  0x0a, 0x38, 0x02, // Usage (AC Pan)
  0x15, 0x81, // Logical Minimum (-127)
  0x25, 0x7f, // Logical Maximum (127)
  0x75, 0x08, // Report Size (8)
  0x95, 0x01, // Report Count (1)
  0x81, 0x06, // Input (Data, Variable, Relative)
  0xc0, // End Collection
  0xc0, // End Collection
]);

export const UHID_MOUSE_ID = 2;

export interface UhidMouseTransport {
  create(
    id: number,
    descriptor: Uint8Array,
  ): Promise<void>;
  input(id: number, report: Uint8Array): Promise<void>;
  destroy(id: number): Promise<void>;
}

function clampReportAxis(value: number): number {
  return Math.max(-127, Math.min(127, value));
}

function signedByte(value: number): number {
  return value < 0 ? 0x100 + value : value;
}

export function domButtonMask(button: number): number {
  switch (button) {
    case 0:
      return 1;
    case 1:
      return 4;
    case 2:
      return 2;
    case 3:
      return 8;
    case 4:
      return 16;
    default:
      return 0;
  }
}

export class UhidMouseDevice {
  readonly #transport: UhidMouseTransport;
  readonly #sensitivity: number;
  #opened = false;
  #buttons = 0;
  #dirtyButtons = false;
  #motionX = 0;
  #motionY = 0;
  #wheelX = 0;
  #wheelY = 0;
  #inFlight = false;
  #currentWritePromise: Promise<void> | null = null;
  #flushResolvers: Array<() => void> = [];

  constructor(transport: UhidMouseTransport, sensitivity = 1) {
    this.#transport = transport;
    this.#sensitivity = Math.max(0.1, Math.min(4, sensitivity));
  }

  get opened(): boolean {
    return this.#opened;
  }

  get buttons(): number {
    return this.#buttons;
  }

  async open(): Promise<void> {
    if (this.#opened) return;
    await this.#transport.create(UHID_MOUSE_ID, UHID_MOUSE_REPORT_DESCRIPTOR);
    this.#opened = true;
  }

  async move(deltaX: number, deltaY: number): Promise<void> {
    if (!this.#opened || !Number.isFinite(deltaX) || !Number.isFinite(deltaY)) {
      return;
    }
    this.#motionX += deltaX * this.#sensitivity;
    this.#motionY += deltaY * this.#sensitivity;
    return this.#triggerPump();
  }

  async button(button: number, pressed: boolean): Promise<boolean> {
    if (!this.#opened) return false;
    const mask = domButtonMask(button);
    if (!mask) return false;
    const next = pressed
      ? this.#buttons | mask
      : this.#buttons & ~mask;
    if (next === this.#buttons) return true;
    this.#buttons = next;
    this.#dirtyButtons = true;
    await this.#triggerPump();
    return true;
  }

  async scroll(horizontal: number, vertical: number): Promise<void> {
    if (
      !this.#opened ||
      !Number.isFinite(horizontal) ||
      !Number.isFinite(vertical)
    ) {
      return;
    }
    this.#wheelX += horizontal;
    this.#wheelY += vertical;
    return this.#triggerPump();
  }

  async releaseButtons(): Promise<void> {
    if (!this.#opened || this.#buttons === 0) return;
    this.#buttons = 0;
    this.#dirtyButtons = true;
    await this.#triggerPump();
  }

  async flush(): Promise<void> {
    if (!this.#opened) return;
    if (!this.#inFlight && !this.#hasPendingWork()) {
      return;
    }
    return new Promise<void>((resolve) => {
      this.#flushResolvers.push(resolve);
      void this.#triggerPump();
    });
  }

  async close(): Promise<void> {
    if (!this.#opened) return;
    try {
      await this.releaseButtons();
      await this.flush();
    } finally {
      this.#opened = false;
      this.#motionX = 0;
      this.#motionY = 0;
      this.#wheelX = 0;
      this.#wheelY = 0;
      this.#dirtyButtons = false;
      this.#notifyFlush();
      await this.#transport.destroy(UHID_MOUSE_ID);
    }
  }

  #hasPendingWork(): boolean {
    return (
      this.#dirtyButtons ||
      Math.trunc(this.#motionX) !== 0 ||
      Math.trunc(this.#motionY) !== 0 ||
      Math.trunc(this.#wheelX) !== 0 ||
      Math.trunc(this.#wheelY) !== 0
    );
  }

  #notifyFlush(): void {
    if (!this.#inFlight && !this.#hasPendingWork() && this.#flushResolvers.length > 0) {
      const resolvers = this.#flushResolvers;
      this.#flushResolvers = [];
      for (const resolve of resolvers) {
        resolve();
      }
    }
  }

  #triggerPump(): Promise<void> {
    if (!this.#opened) return Promise.resolve();
    if (!this.#inFlight) {
      this.#inFlight = true;
      const writePromise = (async () => {
        try {
          while (this.#opened) {
            const x = Math.trunc(this.#motionX);
            const y = Math.trunc(this.#motionY);
            const vertical = Math.trunc(this.#wheelY);
            const horizontal = Math.trunc(this.#wheelX);
            const dirtyButtons = this.#dirtyButtons;

            if (
              x === 0 &&
              y === 0 &&
              vertical === 0 &&
              horizontal === 0 &&
              !dirtyButtons
            ) {
              break;
            }

            this.#motionX -= x;
            this.#motionY -= y;
            this.#wheelY -= vertical;
            this.#wheelX -= horizontal;
            this.#dirtyButtons = false;

            let curX = x;
            let curY = y;
            let curVertical = vertical;
            let curHorizontal = horizontal;

            if (
              curX === 0 &&
              curY === 0 &&
              curVertical === 0 &&
              curHorizontal === 0
            ) {
              await this.#sendReport(0, 0, 0, 0);
            } else {
              while (curX || curY || curVertical || curHorizontal) {
                const nextX = clampReportAxis(curX);
                const nextY = clampReportAxis(curY);
                const nextVertical = clampReportAxis(curVertical);
                const nextHorizontal = clampReportAxis(curHorizontal);
                await this.#sendReport(
                  nextX,
                  nextY,
                  nextVertical,
                  nextHorizontal,
                );
                curX -= nextX;
                curY -= nextY;
                curVertical -= nextVertical;
                curHorizontal -= nextHorizontal;
              }
            }
          }
        } finally {
          this.#inFlight = false;
          this.#currentWritePromise = null;
          this.#notifyFlush();
        }
      })();
      this.#currentWritePromise = writePromise;
      return writePromise;
    }
    return this.#currentWritePromise ?? Promise.resolve();
  }

  #sendReport(
    deltaX: number,
    deltaY: number,
    wheelY: number,
    wheelX: number,
  ): Promise<void> {
    const report = new Uint8Array(5);
    report[0] = this.#buttons;
    report[1] = signedByte(deltaX);
    report[2] = signedByte(deltaY);
    report[3] = signedByte(wheelY);
    report[4] = signedByte(wheelX);
    return this.#transport.input(UHID_MOUSE_ID, report);
  }
}
