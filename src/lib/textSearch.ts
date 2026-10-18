import type { NormalizedBox } from "./pageGeometry";

export type Matrix = [number, number, number, number, number, number];

export interface SearchItem {
  str: string;
  /** Text matrix in PDF user space (pdf.js `item.transform`). */
  transform: number[];
  /** Advance width in user space. */
  width: number;
}

function apply(m: readonly number[], x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

/**
 * Finds every case-insensitive occurrence of `term` in a page's text items and returns boxes in
 * normalized display coordinates. `viewport` maps user space to display pixels (pdf.js
 * `viewport.transform` at scale 1) for a page of `pageWidth` x `pageHeight` (display).
 * Character positions inside an item are estimated proportionally, with a small margin.
 */
export function findTermBoxes(items: readonly SearchItem[], term: string, viewport: readonly number[], pageWidth: number, pageHeight: number): NormalizedBox[] {
  const needle = term.trim().toLowerCase();
  if (needle === "") return [];
  const boxes: NormalizedBox[] = [];
  for (const item of items) {
    const haystack = item.str.toLowerCase();
    const [a, b, c, d, e, f] = item.transform;
    const advance = Math.hypot(a, b) || 1;
    const height = Math.hypot(c, d) || advance;
    const ux = a / advance;
    const uy = b / advance;
    const vx = c / height;
    const vy = d / height;
    for (let at = haystack.indexOf(needle); at >= 0; at = haystack.indexOf(needle, at + needle.length)) {
      const startRatio = at / item.str.length;
      const endRatio = (at + needle.length) / item.str.length;
      const x0 = item.width * startRatio - height * 0.1;
      const x1 = item.width * endRatio + height * 0.1;
      const y0 = -height * 0.3;
      const y1 = height * 1.05;
      const corners = [
        [x0, y0],
        [x1, y0],
        [x0, y1],
        [x1, y1],
      ].map(([lx, ly]) => apply(viewport, e + lx * ux + ly * vx, f + lx * uy + ly * vy));
      const xs = corners.map(([x]) => x);
      const ys = corners.map(([, y]) => y);
      const left = Math.max(0, Math.min(...xs));
      const top = Math.max(0, Math.min(...ys));
      const right = Math.min(pageWidth, Math.max(...xs));
      const bottom = Math.min(pageHeight, Math.max(...ys));
      if (right > left && bottom > top) {
        boxes.push({ x: left / pageWidth, y: top / pageHeight, width: (right - left) / pageWidth, height: (bottom - top) / pageHeight });
      }
    }
  }
  return boxes;
}
