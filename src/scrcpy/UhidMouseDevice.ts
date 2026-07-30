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
  #motionX = 0;
  #motionY = 0;
  #wheelX = 0;
  #wheelY = 0;

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
    const x = Math.trunc(this.#motionX);
    const y = Math.trunc(this.#motionY);
    this.#motionX -= x;
    this.#motionY -= y;
    await this.#sendChunks(x, y, 0, 0);
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
    await this.#sendReport(0, 0, 0, 0);
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
    const x = Math.trunc(this.#wheelX);
    const y = Math.trunc(this.#wheelY);
    this.#wheelX -= x;
    this.#wheelY -= y;
    await this.#sendChunks(0, 0, y, x);
  }

  async releaseButtons(): Promise<void> {
    if (!this.#opened || this.#buttons === 0) return;
    this.#buttons = 0;
    await this.#sendReport(0, 0, 0, 0);
  }

  async close(): Promise<void> {
    if (!this.#opened) return;
    try {
      await this.releaseButtons();
    } finally {
      this.#opened = false;
      this.#motionX = 0;
      this.#motionY = 0;
      this.#wheelX = 0;
      this.#wheelY = 0;
      await this.#transport.destroy(UHID_MOUSE_ID);
    }
  }

  async #sendChunks(
    deltaX: number,
    deltaY: number,
    wheelY: number,
    wheelX: number,
  ): Promise<void> {
    let x = deltaX;
    let y = deltaY;
    let vertical = wheelY;
    let horizontal = wheelX;
    while (x || y || vertical || horizontal) {
      const nextX = clampReportAxis(x);
      const nextY = clampReportAxis(y);
      const nextVertical = clampReportAxis(vertical);
      const nextHorizontal = clampReportAxis(horizontal);
      await this.#sendReport(
        nextX,
        nextY,
        nextVertical,
        nextHorizontal,
      );
      x -= nextX;
      y -= nextY;
      vertical -= nextVertical;
      horizontal -= nextHorizontal;
    }
  }

  #sendReport(
    deltaX: number,
    deltaY: number,
    wheelY: number,
    wheelX: number,
  ): Promise<void> {
    return this.#transport.input(
      UHID_MOUSE_ID,
      new Uint8Array([
        this.#buttons,
        signedByte(deltaX),
        signedByte(deltaY),
        signedByte(wheelY),
        signedByte(wheelX),
      ]),
    );
  }
}
