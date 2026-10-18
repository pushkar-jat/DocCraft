import { describe, expect, it } from "vitest";
import { anchorPoint, displayMarginsToUser, displaySize, displayToUser, normalizedToUser, normalizeRotation, rotatedStartForCenter, type Rotation } from "./pageGeometry";

/** User space -> display space (the inverse), used to check round trips. */
function userToDisplay(rotation: Rotation, w: number, h: number, x: number, y: number): [number, number] {
  switch (rotation) {
    case 90:
      return [y, w - x];
    case 180:
      return [w - x, h - y];
    case 270:
      return [h - y, x];
    default:
      return [x, y];
  }
}

describe("rotation helpers", () => {
  it("normalizes any multiple of 90", () => {
    expect([0, 90, 180, 270, 360, -90, 450].map(normalizeRotation)).toEqual([0, 90, 180, 270, 0, 270, 90]);
  });

  it("swaps width and height for quarter turns", () => {
    expect(displaySize(90, 595, 842)).toEqual({ width: 842, height: 595 });
    expect(displaySize(180, 595, 842)).toEqual({ width: 595, height: 842 });
  });

  it("maps display points to user space and back for every rotation", () => {
    const w = 600;
    const h = 800;
    for (const rotation of [0, 90, 180, 270] as Rotation[]) {
      const { width: dw, height: dh } = displaySize(rotation, w, h);
      for (const [dx, dy] of [[0, 0], [dw, 0], [0, dh], [dw, dh], [123, 45]]) {
        const user = displayToUser(rotation, w, h, dx, dy);
        expect(user.x).toBeGreaterThanOrEqual(0);
        expect(user.x).toBeLessThanOrEqual(w);
        expect(userToDisplay(rotation, w, h, user.x, user.y), `rotation ${rotation}`).toEqual([dx, dy]);
        expect(user.angle).toBe(rotation);
      }
    }
  });

  it("maps display margins to the matching unrotated sides", () => {
    const m = { top: 1, right: 2, bottom: 3, left: 4 };
    expect(displayMarginsToUser(0, m)).toEqual(m);
    expect(displayMarginsToUser(90, m)).toEqual({ left: 1, top: 2, right: 3, bottom: 4 });
    expect(displayMarginsToUser(180, m)).toEqual({ bottom: 1, left: 2, top: 3, right: 4 });
    expect(displayMarginsToUser(270, m)).toEqual({ right: 1, bottom: 2, left: 3, top: 4 });
  });

  it("checks margin mapping against the point mapping", () => {
    // A point just inside the display top edge must be inside the matching user-space margin.
    const w = 600;
    const h = 800;
    for (const rotation of [90, 180, 270] as Rotation[]) {
      const { width: dw, height: dh } = displaySize(rotation, w, h);
      const user = displayToUser(rotation, w, h, dw / 2, dh - 1);
      const sides = displayMarginsToUser(rotation, { top: 10, right: 0, bottom: 0, left: 0 });
      const inside =
        (sides.left === 10 && user.x < 10) ||
        (sides.right === 10 && user.x > w - 10) ||
        (sides.bottom === 10 && user.y < 10) ||
        (sides.top === 10 && user.y > h - 10);
      expect(inside, `rotation ${rotation}`).toBe(true);
    }
  });
});

describe("normalizedToUser", () => {
  const crop = { x: 10, y: 20, width: 600, height: 800 };

  it("maps an upright box using the crop box offset", () => {
    const result = normalizedToUser(0, crop, { x: 0.5, y: 0, width: 0.5, height: 0.25 });
    // Top-right quarter-height band: x 300..600, y (display) 600..800, shifted by the crop origin.
    expect(result.rect).toEqual({ x: 310, y: 620, width: 300, height: 200 });
    expect(result.origin).toEqual({ x: 310, y: 620 });
    expect([result.width, result.height, result.angle]).toEqual([300, 200, 0]);
  });

  it("keeps visible size and lands inside the page for every rotation", () => {
    for (const rotation of [0, 90, 180, 270] as Rotation[]) {
      const { width: dw, height: dh } = displaySize(rotation, crop.width, crop.height);
      const result = normalizedToUser(rotation, crop, { x: 0.1, y: 0.2, width: 0.3, height: 0.1 });
      expect(result.width).toBeCloseTo(0.3 * dw);
      expect(result.height).toBeCloseTo(0.1 * dh);
      expect(result.rect.x).toBeGreaterThanOrEqual(crop.x - 1e-9);
      expect(result.rect.x + result.rect.width).toBeLessThanOrEqual(crop.x + crop.width + 1e-9);
      expect(result.rect.y).toBeGreaterThanOrEqual(crop.y - 1e-9);
      expect(result.rect.y + result.rect.height).toBeLessThanOrEqual(crop.y + crop.height + 1e-9);
      expect(result.angle).toBe(rotation);
      // The drawing origin is one corner of the user-space rectangle.
      expect([result.rect.x, result.rect.x + result.rect.width]).toContainEqual(expect.closeTo(result.origin.x));
      expect([result.rect.y, result.rect.y + result.rect.height]).toContainEqual(expect.closeTo(result.origin.y));
    }
  });
});

describe("text placement", () => {
  it("anchors text in each corner and centre", () => {
    expect(anchorPoint("bottom-center", 600, 800, 40, 10, 20)).toEqual({ dx: 280, dy: 20 });
    expect(anchorPoint("top-right", 600, 800, 40, 10, 20)).toEqual({ dx: 540, dy: 770 });
    expect(anchorPoint("bottom-left", 600, 800, 40, 10, 20)).toEqual({ dx: 20, dy: 20 });
  });

  it("centres rotated text on the requested point", () => {
    const start = rotatedStartForCenter(300, 400, 200, 50, 45);
    const radians = Math.PI / 4;
    const cx = start.x + 100 * Math.cos(radians) - 25 * Math.sin(radians);
    const cy = start.y + 100 * Math.sin(radians) + 25 * Math.cos(radians);
    expect(cx).toBeCloseTo(300);
    expect(cy).toBeCloseTo(400);
  });
});
