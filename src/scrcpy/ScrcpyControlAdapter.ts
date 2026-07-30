import {
  AndroidKeyCode,
  AndroidKeyEventAction,
  AndroidKeyEventMeta,
  AndroidMotionEventAction,
  AndroidMotionEventButton,
  type ScrcpyControlMessageWriter,
  ScrcpyPointerId,
} from "@yume-chan/scrcpy";

import type {
  MouseInputMode,
  NormalizedPoint,
  Size,
} from "../core/types";
import { normalizedToVideo } from "../coordinates/CoordinateTransform";
import type { Diagnostics } from "../debug/Diagnostics";
import type {
  SyntheticTouchEvent,
  SyntheticTouchSink,
} from "../input/TouchRegistry";
import {
  domButtonMask,
  UhidMouseDevice,
} from "./UhidMouseDevice";

export interface KeyInjection {
  code: number;
  action: "down" | "up";
  repeat?: number;
  metaState?: number;
}

export class ScrcpyControlAdapter implements SyntheticTouchSink {
  #chain: Promise<void> = Promise.resolve();
  #clipboardSequence = 1n;
  #uhidMouse?: UhidMouseDevice;
  readonly #sdkPressedButtons = new Set<number>();
  #sdkPointer: NormalizedPoint = { x: 0.5, y: 0.5 };

  constructor(
    private readonly controller: ScrcpyControlMessageWriter,
    private readonly getVideoSize: () => Size,
    private readonly diagnostics: Diagnostics,
    readonly mouseMode: MouseInputMode = "disabled",
    private readonly mouseSensitivity = 1,
  ) {}

  async initializeMouse(): Promise<void> {
    if (this.mouseMode !== "uhid" || this.#uhidMouse) return;
    const mouse = new UhidMouseDevice(
      {
        create: (id, descriptor) =>
          this.controller.uHidCreate({
            id,
            vendorId: 0,
            productId: 0,
            name: "",
            data: descriptor,
          }),
        input: (id, data) => this.controller.uHidInput({ id, data }),
        destroy: (id) => this.controller.uHidDestroy(id),
      },
      this.mouseSensitivity,
    );
    this.#uhidMouse = mouse;
    await this.#enqueue("uhid-mouse-create", () => mouse.open());
    this.diagnostics.info(
      "control",
      "uhid-mouse-created",
      "Created an Android UHID physical mouse. Relative motion, five buttons, and two-axis scrolling are active.",
    );
  }

  touch(event: SyntheticTouchEvent): Promise<void> {
    return this.#enqueue("synthetic-touch", () => this.#injectTouch(event));
  }

  directTouch(
    phase: SyntheticTouchEvent["phase"],
    pointerId: bigint,
    point: NormalizedPoint,
    buttons: number = AndroidMotionEventButton.Primary,
    actionButton: number = AndroidMotionEventButton.Primary,
  ): Promise<void> {
    return this.#enqueue("direct-touch", () =>
      this.#injectTouch({
        phase,
        pointerId,
        point,
        pressure: phase === "up" || phase === "cancel" ? 0 : 1,
        buttons: phase === "up" || phase === "cancel" ? 0 : buttons,
      }, actionButton),
    );
  }

  mouseMove(point: NormalizedPoint, browserButtons = 0): Promise<void> {
    void browserButtons;
    if (this.mouseMode !== "sdk") return Promise.resolve();
    this.#sdkPointer = point;
    const buttons = this.#sdkButtonMask();
    return this.#enqueue("sdk-mouse-move", () =>
      this.#injectMouseMotion(point, buttons),
    );
  }

  mouseMoveRelative(deltaX: number, deltaY: number): Promise<void> {
    if (this.mouseMode !== "uhid" || !this.#uhidMouse) {
      return Promise.resolve();
    }
    return this.#enqueue("uhid-mouse-move", () =>
      this.#uhidMouse!.move(deltaX, deltaY),
    );
  }

  mouseButton(
    point: NormalizedPoint,
    button: number,
    pressed: boolean,
    browserButtons: number,
  ): Promise<void> {
    void browserButtons;
    if (this.mouseMode === "uhid" && this.#uhidMouse) {
      return this.#enqueue("uhid-mouse-button", async () => {
        await this.#uhidMouse!.button(button, pressed);
      });
    }
    if (this.mouseMode !== "sdk") return Promise.resolve();
    if (domButtonMask(button) === 0) return Promise.resolve();
    this.#sdkPointer = point;
    if (pressed) {
      this.#sdkPressedButtons.add(button);
    } else {
      this.#sdkPressedButtons.delete(button);
    }
    const buttons = this.#sdkButtonMask();
    return this.#enqueue("sdk-mouse-button", () =>
      this.#injectMouseButton(
        point,
        button,
        pressed,
        buttons,
      ),
    );
  }

  releaseMouseButtons(): Promise<void> {
    if (this.mouseMode === "uhid" && this.#uhidMouse) {
      return this.#enqueue("uhid-mouse-release", () =>
        this.#uhidMouse!.releaseButtons(),
      );
    }
    if (this.mouseMode !== "sdk" || this.#sdkPressedButtons.size === 0) {
      return Promise.resolve();
    }
    const pressed = [...this.#sdkPressedButtons];
    this.#sdkPressedButtons.clear();
    return this.#enqueue("sdk-mouse-release", async () => {
      let buttons = pressed.reduce(
        (mask, button) => mask | domButtonMask(button),
        0,
      );
      for (const button of pressed.reverse()) {
        buttons &= ~domButtonMask(button);
        await this.#injectMouseButton(
          this.#sdkPointer,
          button,
          false,
          buttons,
        );
      }
    });
  }

  key({ code, action, repeat = 0, metaState = 0 }: KeyInjection): Promise<void> {
    return this.#enqueue("key", () =>
      this.controller.injectKeyCode({
        action:
          action === "down" ? AndroidKeyEventAction.Down : AndroidKeyEventAction.Up,
        keyCode: code as typeof AndroidKeyCode[keyof typeof AndroidKeyCode],
        repeat,
        metaState:
          metaState as typeof AndroidKeyEventMeta[keyof typeof AndroidKeyEventMeta],
      }),
    );
  }

  async keyPress(code: number, metaState = 0): Promise<void> {
    await this.key({ code, action: "down", metaState });
    await this.key({ code, action: "up", metaState });
  }

  text(text: string): Promise<void> {
    return this.#enqueue("text", () => this.controller.injectText(text));
  }

  scroll(
    point: NormalizedPoint,
    scrollX: number,
    scrollY: number,
    browserButtons = 0,
  ): Promise<void> {
    void browserButtons;
    if (this.mouseMode === "uhid" && this.#uhidMouse) {
      return this.#enqueue("uhid-mouse-scroll", () =>
        this.#uhidMouse!.scroll(scrollX, scrollY),
      );
    }
    if (this.mouseMode !== "sdk") return Promise.resolve();
    this.#sdkPointer = point;
    const buttons = this.#sdkButtonMask();
    return this.#enqueue("scroll", async () => {
      const size = this.#protocolSize();
      const position = normalizedToVideo(point, size);
      await this.controller.injectScroll({
        pointerX: position.x,
        pointerY: position.y,
        videoWidth: size.width,
        videoHeight: size.height,
        scrollX,
        scrollY,
        buttons,
      });
    });
  }

  rotate(): Promise<void> {
    return this.#enqueue("rotate", () => this.controller.rotateDevice());
  }

  back(): Promise<void> {
    return this.keyPress(AndroidKeyCode.AndroidBack);
  }

  home(): Promise<void> {
    return this.keyPress(AndroidKeyCode.AndroidHome);
  }

  appSwitch(): Promise<void> {
    return this.keyPress(AndroidKeyCode.AndroidAppSwitch);
  }

  power(): Promise<void> {
    return this.keyPress(AndroidKeyCode.Power);
  }

  volumeUp(): Promise<void> {
    return this.keyPress(AndroidKeyCode.VolumeUp);
  }

  volumeDown(): Promise<void> {
    return this.keyPress(AndroidKeyCode.VolumeDown);
  }

  setClipboard(content: string, paste = false): Promise<void> {
    const sequence = this.#clipboardSequence++;
    return this.#enqueue("clipboard", () =>
      this.controller.setClipboard({ sequence, paste, content }),
    );
  }

  async flush(): Promise<void> {
    await this.#chain;
  }

  async close(): Promise<void> {
    try {
      await this.releaseMouseButtons();
    } catch {
      // The control socket may already be closed during disconnect cleanup.
    }
    const mouse = this.#uhidMouse;
    this.#uhidMouse = undefined;
    if (mouse) {
      try {
        await this.#enqueue("uhid-mouse-destroy", () => mouse.close());
      } catch {
        // The control socket may already be closed during disconnect cleanup.
      }
    }
    await this.flush();
  }

  #injectTouch(
    event: SyntheticTouchEvent,
    actionButton: number = AndroidMotionEventButton.Primary,
  ): Promise<void> {
    const size = this.#protocolSize();
    const point = normalizedToVideo(event.point, size);
    return this.controller.injectTouch({
      action: this.#touchAction(event.phase),
      pointerId: event.pointerId,
      pointerX: point.x,
      pointerY: point.y,
      videoWidth: size.width,
      videoHeight: size.height,
      pressure: event.pressure,
      actionButton,
      buttons: event.buttons,
    });
  }

  #injectMouseMotion(
    point: NormalizedPoint,
    buttons: number,
  ): Promise<void> {
    const size = this.#protocolSize();
    const position = normalizedToVideo(point, size);
    return this.controller.injectTouch({
      action:
        buttons === 0
          ? AndroidMotionEventAction.HoverMove
          : AndroidMotionEventAction.Move,
      pointerId: ScrcpyPointerId.Mouse,
      pointerX: position.x,
      pointerY: position.y,
      videoWidth: size.width,
      videoHeight: size.height,
      pressure: 1,
      actionButton: AndroidMotionEventButton.None,
      buttons,
    });
  }

  #injectMouseButton(
    point: NormalizedPoint,
    button: number,
    pressed: boolean,
    buttons: number,
  ): Promise<void> {
    const size = this.#protocolSize();
    const position = normalizedToVideo(point, size);
    return this.controller.injectTouch({
      action: pressed
        ? AndroidMotionEventAction.Down
        : AndroidMotionEventAction.Up,
      pointerId: ScrcpyPointerId.Mouse,
      pointerX: position.x,
      pointerY: position.y,
      videoWidth: size.width,
      videoHeight: size.height,
      pressure: pressed ? 1 : 0,
      actionButton: domButtonMask(button),
      buttons,
    });
  }

  #sdkButtonMask(): number {
    let mask = 0;
    for (const button of this.#sdkPressedButtons) {
      mask |= domButtonMask(button);
    }
    return mask;
  }

  #protocolSize(): Size {
    const size = this.getVideoSize();
    if (size.width <= 0 || size.height <= 0) {
      throw new Error("Video dimensions are not available yet");
    }
    const scale = Math.min(1, 65_535 / Math.max(size.width, size.height));
    return {
      width: Math.max(1, Math.round(size.width * scale)),
      height: Math.max(1, Math.round(size.height * scale)),
    };
  }

  #touchAction(
    phase: SyntheticTouchEvent["phase"],
  ): typeof AndroidMotionEventAction[keyof typeof AndroidMotionEventAction] {
    switch (phase) {
      case "down":
        return AndroidMotionEventAction.Down;
      case "move":
        return AndroidMotionEventAction.Move;
      case "up":
        return AndroidMotionEventAction.Up;
      case "cancel":
        return AndroidMotionEventAction.Cancel;
    }
  }

  #enqueue(event: string, operation: () => Promise<void>): Promise<void> {
    const next = this.#chain.then(operation);
    this.#chain = next.catch((error) => {
      this.diagnostics.error(
        "control",
        "control-write-failed",
        `scrcpy control write failed during ${event}.`,
        error,
      );
    });
    return next;
  }
}
