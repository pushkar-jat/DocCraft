/**
 * Geometry for pages with a /Rotate value. Users think in *display* coordinates (what they see);
 * PDF drawing happens in *user space* (the unrotated page). These helpers convert between them.
 * Coordinates are PDF points with the origin at the bottom-left.
 */

export type Rotation = 0 | 90 | 180 | 270;

export function normalizeRotation(angle: number): Rotation {
  const r = ((Math.round(angle / 90) * 90) % 360 + 360) % 360;
  return r as Rotation;
}

/** Size of the page as displayed, given its unrotated width/height. */
export function displaySize(rotation: Rotation, width: number, height: number): { width: number; height: number } {
  return rotation === 90 || rotation === 270 ? { width: height, height: width } : { width, height };
}

/**
 * Maps a point in display space to user space, plus the angle text must be drawn at so that it
 * reads left-to-right on screen.
 */
export function displayToUser(rotation: Rotation, width: number, height: number, dx: number, dy: number): { x: number; y: number; angle: number } {
  switch (rotation) {
    case 90:
      return { x: width - dy, y: dx, angle: 90 };
    case 180:
      return { x: width - dx, y: height - dy, angle: 180 };
    case 270:
      return { x: dy, y: height - dx, angle: 270 };
    default:
      return { x: dx, y: dy, angle: 0 };
  }
}

export interface Margins {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** Converts margins the user sees (display sides) to margins on the unrotated page. */
export function displayMarginsToUser(rotation: Rotation, margins: Margins): Margins {
  const { top, right, bottom, left } = margins;
  switch (rotation) {
    case 90:
      return { left: top, right: bottom, bottom: left, top: right };
    case 180:
      return { top: bottom, bottom: top, left: right, right: left };
    case 270:
      return { right: top, left: bottom, top: left, bottom: right };
    default:
      return { ...margins };
  }
}

/** A box on the page as the user sees it, as fractions (0..1) of the visible page, origin top-left. */
export interface NormalizedBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CropBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Converts a user-drawn box to PDF user space.
 * Returns the axis-aligned rectangle in user space (for fills), the user-space point of the box's
 * visible bottom-left corner, its visible size in points, and the angle to draw upright content at.
 */
export function normalizedToUser(rotation: Rotation, crop: CropBox, box: NormalizedBox) {
  const display = displaySize(rotation, crop.width, crop.height);
  const left = box.x * display.width;
  const right = (box.x + box.width) * display.width;
  // Display y grows downwards in the normalized box; PDF display space grows upwards.
  const bottom = (1 - box.y - box.height) * display.height;
  const top = (1 - box.y) * display.height;
  const corners = [
    [left, bottom],
    [right, bottom],
    [left, top],
    [right, top],
  ].map(([dx, dy]) => displayToUser(rotation, crop.width, crop.height, dx, dy));
  const xs = corners.map((point) => point.x + crop.x);
  const ys = corners.map((point) => point.y + crop.y);
  return {
    rect: { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) },
    origin: { x: corners[0].x + crop.x, y: corners[0].y + crop.y },
    width: right - left,
    height: top - bottom,
    angle: corners[0].angle,
  };
}

export type Anchor ="top-left" | "top-center" | "top-right" | "bottom-left" | "bottom-center" | "bottom-right";

/**
 * Display-space start point for a single line of text of `textWidth` x `textHeight`
 * placed at `anchor` with `margin` from the page edges.
 */
export function anchorPoint(anchor: Anchor, pageWidth: number, pageHeight: number, textWidth: number, textHeight: number, margin: number): { dx: number; dy: number } {
  const [vertical, horizontal] = anchor.split("-") as ["top" | "bottom", "left" | "center" | "right"];
  const dx = horizontal === "left" ? margin : horizontal === "right" ? pageWidth - margin - textWidth : (pageWidth - textWidth) / 2;
  const dy = vertical === "bottom" ? margin : pageHeight - margin - textHeight;
  return { dx, dy };
}

/**
 * Start point for text of size w x h rotated by `angle` degrees so that its centre lands on (cx, cy).
 * pdf-lib rotates text around its start point, so the start must be offset accordingly.
 */
export function rotatedStartForCenter(cx: number, cy: number, w: number, h: number, angle: number): { x: number; y: number } {
  const radians = (angle * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  // Centre of the text box relative to its start point, after rotation.
  const ox = (w / 2) * cos - (h / 2) * sin;
  const oy = (w / 2) * sin + (h / 2) * cos;
  return { x: cx - ox, y: cy - oy };
}
