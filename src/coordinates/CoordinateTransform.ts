import type { NormalizedPoint, Size } from "../core/types";
import { clamp } from "../core/types";

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type QuarterTurn = 0 | 90 | 180 | 270;

export function containedRect(container: Rect, content: Size): Rect {
  if (
    container.width <= 0 ||
    container.height <= 0 ||
    content.width <= 0 ||
    content.height <= 0
  ) {
    return { ...container, width: 0, height: 0 };
  }
  const scale = Math.min(
    container.width / content.width,
    container.height / content.height,
  );
  const width = content.width * scale;
  const height = content.height * scale;
  return {
    left: container.left + (container.width - width) / 2,
    top: container.top + (container.height - height) / 2,
    width,
    height,
  };
}

export function clientToNormalized(
  client: { x: number; y: number },
  contentRect: Rect,
  clampOutside = false,
): NormalizedPoint | undefined {
  if (contentRect.width <= 0 || contentRect.height <= 0) return undefined;
  const x = (client.x - contentRect.left) / contentRect.width;
  const y = (client.y - contentRect.top) / contentRect.height;
  if (!clampOutside && (x < 0 || x > 1 || y < 0 || y > 1)) return undefined;
  return { x: clamp(x), y: clamp(y) };
}

/**
 * Convert a browser coordinate against the pixels where video is actually
 * visible. This deliberately derives the contained video rectangle at event
 * time instead of assuming that an element's CSS box has the same aspect
 * ratio as the decoded frame.
 */
export function clientToNormalizedContained(
  client: { x: number; y: number },
  containerRect: Rect,
  content: Size,
  clampOutside = false,
): NormalizedPoint | undefined {
  return clientToNormalized(
    client,
    containedRect(containerRect, content),
    clampOutside,
  );
}

export function normalizedToClient(
  point: NormalizedPoint,
  contentRect: Rect,
): { x: number; y: number } {
  return {
    x: contentRect.left + clamp(point.x) * contentRect.width,
    y: contentRect.top + clamp(point.y) * contentRect.height,
  };
}

export function normalizedToVideo(
  point: NormalizedPoint,
  video: Size,
): { x: number; y: number } {
  return {
    x: Math.round(clamp(point.x) * Math.max(0, video.width - 1)),
    y: Math.round(clamp(point.y) * Math.max(0, video.height - 1)),
  };
}

export function normalizedVisibleToSource(
  point: NormalizedPoint,
  source: Size,
  crop?: CropRect,
): { x: number; y: number } {
  const visible = crop ?? { x: 0, y: 0, ...source };
  return {
    x: clamp(
      visible.x + clamp(point.x) * Math.max(0, visible.width - 1),
      0,
      source.width - 1,
    ),
    y: clamp(
      visible.y + clamp(point.y) * Math.max(0, visible.height - 1),
      0,
      source.height - 1,
    ),
  };
}

export function rotateNormalized(
  point: NormalizedPoint,
  rotation: QuarterTurn,
): NormalizedPoint {
  switch (rotation) {
    case 0:
      return { ...point };
    case 90:
      return { x: 1 - point.y, y: point.x };
    case 180:
      return { x: 1 - point.x, y: 1 - point.y };
    case 270:
      return { x: point.y, y: 1 - point.x };
  }
}

export function orientationOf(size: Size): "portrait" | "landscape" | "square" {
  if (size.width === size.height) return "square";
  return size.width > size.height ? "landscape" : "portrait";
}

export class CoordinateTransform {
  #container: Rect;
  #video: Size;
  #rotation: QuarterTurn;

  constructor(container: Rect, video: Size, rotation: QuarterTurn = 0) {
    this.#container = container;
    this.#video = video;
    this.#rotation = rotation;
  }

  get contentRect(): Rect {
    return containedRect(this.#container, this.#video);
  }

  clientToNormalized(
    client: { x: number; y: number },
    clampOutside = false,
  ): NormalizedPoint | undefined {
    const point = clientToNormalized(client, this.contentRect, clampOutside);
    return point ? rotateNormalized(point, this.#rotation) : undefined;
  }

  clientToVideo(
    client: { x: number; y: number },
    clampOutside = false,
  ): { x: number; y: number } | undefined {
    const point = this.clientToNormalized(client, clampOutside);
    return point ? normalizedToVideo(point, this.#video) : undefined;
  }

  update(container: Rect, video: Size, rotation = this.#rotation): void {
    this.#container = container;
    this.#video = video;
    this.#rotation = rotation;
  }
}
