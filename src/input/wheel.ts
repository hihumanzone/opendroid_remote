export interface NormalizedWheelDelta {
  x: number;
  y: number;
}

const LINE_MODE = 1;
const PAGE_MODE = 2;

function clampScroll(value: number): number {
  return Math.max(-16, Math.min(16, value));
}

export function normalizeWheelDelta(
  deltaX: number,
  deltaY: number,
  deltaMode: number,
  pageSize: number,
): NormalizedWheelDelta {
  const unit =
    deltaMode === LINE_MODE
      ? 32
      : deltaMode === PAGE_MODE
        ? Math.max(1, pageSize)
        : 1;
  return {
    x: clampScroll((-deltaX * unit) / 100),
    y: clampScroll((-deltaY * unit) / 100),
  };
}
