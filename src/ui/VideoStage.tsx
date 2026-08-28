"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";

import type {
  MouseInputMode,
  NormalizedPoint,
  Size,
} from "../core/types";
import {
  clientToNormalizedContained,
  containedRect,
} from "../coordinates/CoordinateTransform";
import { PointerIdAllocator } from "../input/PointerIdAllocator";
import type { ControlMode } from "../input/controlMode";
import { shouldCaptureMouseButton } from "../input/controlMode";
import type { TouchPhase } from "../input/TouchRegistry";
import { normalizeWheelDelta } from "../input/wheel";
import type { GameProfile } from "../profiles/schema";
import { MappingOverlay } from "./MappingOverlay";

interface DirectPointer {
  id: bigint;
  point: NormalizedPoint;
  buttons: number;
}

const PRIMARY_TOUCH_BUTTON = 1;

export interface VideoStageProps {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  surfaceRef: MutableRefObject<HTMLDivElement | null>;
  fullscreenRef: MutableRefObject<HTMLDivElement | null>;
  videoSize: Size;
  streaming: boolean;
  status: string;
  profile?: GameProfile;
  selectedMappingId?: string;
  mode: ControlMode;
  overlaysVisible: boolean;
  mappedMouseButtons: ReadonlySet<number>;
  hasMouseLook: boolean;
  cameraLockActive?: boolean;
  mouseMode: MouseInputMode;
  pointerLocked: boolean;
  onSelectMapping(id?: string): void;
  onMoveMapping(id: string, point: NormalizedPoint): void;
  onMoveSwipeEnd(id: string, point: NormalizedPoint): void;
  onDirectTouch(
    phase: TouchPhase,
    pointerId: bigint,
    point: NormalizedPoint,
    buttons: number,
    actionButton: number,
  ): void;
  onGameMouseDown(button: number): void;
  onGameMouseUp(button: number): void;
  onMouseMove(point: NormalizedPoint, buttons: number): void;
  onMouseMoveRelative(x: number, y: number): void;
  onMouseButton(
    point: NormalizedPoint,
    button: number,
    pressed: boolean,
    buttons: number,
  ): void;
  onReleaseMouseButtons(): void;
  onScroll(
    point: NormalizedPoint,
    x: number,
    y: number,
    buttons: number,
  ): void;
  onRequestPointerLock(): void;
}

function buttonMask(button: number): number {
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

export function VideoStage({
  canvasRef,
  surfaceRef,
  fullscreenRef,
  videoSize,
  streaming,
  status,
  profile,
  selectedMappingId,
  mode,
  overlaysVisible,
  mappedMouseButtons,
  hasMouseLook,
  cameraLockActive = false,
  mouseMode,
  pointerLocked,
  onSelectMapping,
  onMoveMapping,
  onMoveSwipeEnd,
  onDirectTouch,
  onGameMouseDown,
  onGameMouseUp,
  onMouseMove,
  onMouseMoveRelative,
  onMouseButton,
  onReleaseMouseButtons,
  onScroll,
  onRequestPointerLock,
}: VideoStageProps) {
  const fitRef = useRef<HTMLDivElement>(null);
  const pointers = useRef(new PointerIdAllocator(64n, 127n));
  const active = useRef(new Map<number, DirectPointer>());
  const capturedMouse = useRef(new Set<number>());
  const [surfaceSize, setSurfaceSize] = useState<Size>({ width: 0, height: 0 });
  const videoWidth = videoSize.width;
  const videoHeight = videoSize.height;
  const editing = mode === "edit";

  useLayoutEffect(() => {
    const container = fitRef.current;
    if (!container) return;
    const update = () => {
      const rect = container.getBoundingClientRect();
      const content =
        videoWidth > 0 && videoHeight > 0
          ? { width: videoWidth, height: videoHeight }
          : { width: 16, height: 9 };
      const next = containedRect(
        { left: 0, top: 0, width: rect.width, height: rect.height },
        content,
      );
      setSurfaceSize({
        width: Math.max(1, next.width),
        height: Math.max(1, next.height),
      });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(container);

    const handleFullscreenChange = () => {
      update();
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    document.addEventListener("webkitfullscreenchange", handleFullscreenChange);

    return () => {
      observer.disconnect();
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
      document.removeEventListener("webkitfullscreenchange", handleFullscreenChange);
    };
  }, [videoWidth, videoHeight]);

  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;

    const handleWheel = (event: WheelEvent) => {
      if (!streaming || editing) return;

      // React delegates wheel events at the root, where some Chromium versions
      // treat the listener as passive. A native non-passive listener guarantees
      // that Android scrolling never bubbles into the surrounding page.
      event.preventDefault();
      event.stopPropagation();

      const rect = surface.getBoundingClientRect();
      const point = clientToNormalizedContained(
        { x: event.clientX, y: event.clientY },
        {
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
        },
        videoWidth > 0 && videoHeight > 0
          ? { width: videoWidth, height: videoHeight }
          : { width: 16, height: 9 },
        true,
      );
      const resolvedPoint =
        point ?? (mouseMode === "uhid" ? { x: 0.5, y: 0.5 } : undefined);
      if (!resolvedPoint) return;
      const delta = normalizeWheelDelta(
        event.deltaX,
        event.deltaY,
        event.deltaMode,
        Math.max(rect.width, rect.height),
      );
      onScroll(resolvedPoint, delta.x, delta.y, event.buttons);
    };

    surface.addEventListener("wheel", handleWheel, { passive: false });
    return () => surface.removeEventListener("wheel", handleWheel);
  }, [
    editing,
    mouseMode,
    onScroll,
    streaming,
    surfaceRef,
    videoHeight,
    videoWidth,
  ]);

  const releaseCapturedMappings = () => {
    for (const button of capturedMouse.current) onGameMouseUp(button);
    capturedMouse.current.clear();
  };

  useEffect(() => {
    if (!editing && streaming) return;
    for (const [pointerId, pointer] of active.current) {
      onDirectTouch(
        "cancel",
        pointer.id,
        pointer.point,
        0,
        PRIMARY_TOUCH_BUTTON,
      );
      pointers.current.release(`direct:${pointerId}`);
    }
    active.current.clear();
    releaseCapturedMappings();
    onReleaseMouseButtons();
  }, [
    editing,
    onDirectTouch,
    onGameMouseUp,
    onReleaseMouseButtons,
    streaming,
  ]);

  useEffect(() => {
    if (!pointerLocked) {
      releaseCapturedMappings();
    }

    const handleWindowPointerUp = (event: Event) => {
      const pointerEvent = event as PointerEvent;
      if (
        !("pointerType" in pointerEvent) ||
        pointerEvent.pointerType === "mouse"
      ) {
        const mouseEvent = event as MouseEvent;
        if (capturedMouse.current.delete(mouseEvent.button)) {
          onGameMouseUp(mouseEvent.button);
        }
        if (mouseEvent.buttons === 0) {
          releaseCapturedMappings();
          if (!pointerLocked) {
            onReleaseMouseButtons();
          }
        }
      }
    };

    const handleWindowBlur = () => {
      releaseCapturedMappings();
      if (!pointerLocked) {
        onReleaseMouseButtons();
      }
    };

    const upEvent =
      typeof window !== "undefined" && "PointerEvent" in window
        ? "pointerup"
        : "mouseup";

    window.addEventListener(upEvent, handleWindowPointerUp);
    window.addEventListener("blur", handleWindowBlur);

    return () => {
      window.removeEventListener(upEvent, handleWindowPointerUp);
      window.removeEventListener("blur", handleWindowBlur);
    };
  }, [onGameMouseUp, onReleaseMouseButtons, pointerLocked]);

  const pointFor = (
    event: ReactPointerEvent<HTMLDivElement>,
    clampOutside = true,
  ) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return clientToNormalizedContained(
      { x: event.clientX, y: event.clientY },
      {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      },
      videoWidth > 0 && videoHeight > 0
        ? { width: videoWidth, height: videoHeight }
        : { width: 16, height: 9 },
      clampOutside,
    );
  };

  const releasePointer = (
    event: ReactPointerEvent<HTMLDivElement>,
    phase: "up" | "cancel",
  ) => {
    const pointer = active.current.get(event.pointerId);
    if (!pointer) return;
    active.current.delete(event.pointerId);
    pointers.current.release(`direct:${event.pointerId}`);
    const point = pointFor(event);
    if (!point) return;
    onDirectTouch(
      phase,
      pointer.id,
      point,
      0,
      PRIMARY_TOUCH_BUTTON,
    );
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.currentTarget.focus({ preventScroll: true });
    if (!streaming || editing) return;
    event.preventDefault();
    if (event.pointerType === "mouse") {
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // Pointer capture may fail in synthetic environments or if pointer is invalid.
      }
      if (
        shouldCaptureMouseButton(
          mode,
          event.button,
          mappedMouseButtons,
        )
      ) {
        capturedMouse.current.add(event.button);
        onGameMouseDown(event.button);
        if (
          event.button === 0 &&
          ((hasMouseLook && cameraLockActive) || (mouseMode === "uhid" && !pointerLocked))
        ) {
          onRequestPointerLock();
        }
        return;
      }
      if (mouseMode === "disabled") return;
      const point = pointFor(event, false) ?? { x: 0.5, y: 0.5 };
      onMouseButton(
        point,
        event.button,
        true,
        event.buttons || buttonMask(event.button),
      );
      if (
        mouseMode === "uhid" &&
        !pointerLocked &&
        event.button === 0
      ) {
        onRequestPointerLock();
      } else if (hasMouseLook && cameraLockActive && event.button === 0) {
        onRequestPointerLock();
      }
      return;
    }
    const point = pointFor(event, false);
    if (!point) return;
    const id = pointers.current.allocate(`direct:${event.pointerId}`);
    const buttons = PRIMARY_TOUCH_BUTTON;
    active.current.set(event.pointerId, { id, point, buttons });
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic environments or invalid pointer ID
    }
    onDirectTouch(
      "down",
      id,
      point,
      buttons,
      PRIMARY_TOUCH_BUTTON,
    );
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse") {
      if (
        editing ||
        !streaming ||
        pointerLocked ||
        document.pointerLockElement === event.currentTarget
      ) {
        return;
      }
      if (mouseMode === "uhid") {
        if (event.movementX || event.movementY) {
          onMouseMoveRelative(event.movementX, event.movementY);
        }
        return;
      }
      if (mouseMode === "disabled") return;
      const isDragging = event.buttons !== 0 || capturedMouse.current.size > 0;
      const point = pointFor(event, isDragging);
      if (!point) return;
      onMouseMove(point, event.buttons);
      return;
    }
    const pointer = active.current.get(event.pointerId);
    if (!pointer || editing || !streaming) return;
    event.preventDefault();
    const point = pointFor(event);
    if (!point) return;
    pointer.point = point;
    pointer.buttons = PRIMARY_TOUCH_BUTTON;
    onDirectTouch(
      "move",
      pointer.id,
      point,
      pointer.buttons,
      PRIMARY_TOUCH_BUTTON,
    );
  };

  return (
    <section className="video-workspace" ref={fullscreenRef}>
      <div className="video-fit">
        <div className="video-viewport" ref={fitRef}>
          <div
            className={`video-surface ${streaming ? "is-streaming" : ""} ${
              editing ? "is-editing" : ""
            } ${mode === "play" ? "is-play-mode" : ""} ${
              hasMouseLook && mode === "play" && cameraLockActive ? "captures-mouse-look" : ""
            } ${
              mouseMode === "uhid"
                ? "uses-native-mouse"
                : mouseMode === "sdk"
                  ? "uses-sdk-mouse"
                  : "mouse-input-disabled"
            } ${
              pointerLocked ? "is-mouse-locked" : ""
            }`}
            ref={surfaceRef}
            style={{
              width: surfaceSize.width,
              height: surfaceSize.height,
              aspectRatio:
                videoWidth > 0 && videoHeight > 0
                  ? `${videoWidth} / ${videoHeight}`
                  : "16 / 9",
            }}
            tabIndex={0}
            role="application"
            aria-label="Android video and control surface"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={(event) => {
              if (event.pointerType === "mouse") {
                try {
                  if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                    event.currentTarget.releasePointerCapture(event.pointerId);
                  }
                } catch {
                  // Ignore errors releasing capture
                }
                if (capturedMouse.current.delete(event.button)) {
                  onGameMouseUp(event.button);
                  return;
                }
                const point = pointFor(event) ?? { x: 0.5, y: 0.5 };
                onMouseButton(
                  point,
                  event.button,
                  false,
                  event.buttons,
                );
                return;
              }
              releasePointer(event, "up");
            }}
            onPointerCancel={(event) => {
              if (event.pointerType === "mouse") {
                releaseCapturedMappings();
                onReleaseMouseButtons();
                return;
              }
              releasePointer(event, "cancel");
            }}
            onLostPointerCapture={(event) => {
              if (event.pointerType === "mouse") {
                releaseCapturedMappings();
                if (!pointerLocked) onReleaseMouseButtons();
                return;
              }
              const pointer = active.current.get(event.pointerId);
              if (!pointer) return;
              active.current.delete(event.pointerId);
              pointers.current.release(`direct:${event.pointerId}`);
              onDirectTouch(
                "cancel",
                pointer.id,
                pointer.point,
                0,
                PRIMARY_TOUCH_BUTTON,
              );
            }}
            onContextMenu={(event) => event.preventDefault()}
          >
            <canvas ref={canvasRef} className="video-canvas" aria-hidden="true" />
            {!streaming ? (
              <div className="video-empty">
                <div className="device-glyph" aria-hidden="true">
                  <span />
                </div>
                <strong>Android appears here</strong>
                <p>{status}</p>
                <div className="local-badge">
                  <span className="status-dot" />
                  Local USB · no relay
                </div>
              </div>
            ) : null}
            {profile ? (
              <MappingOverlay
                profile={profile}
                selectedId={selectedMappingId}
                editing={editing}
                visible={overlaysVisible}
                surfaceSize={surfaceSize}
                onSelect={onSelectMapping}
                onMove={onMoveMapping}
                onMoveSwipeEnd={onMoveSwipeEnd}
              />
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}
