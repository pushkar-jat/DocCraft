import { describe, expect, it } from "vitest";
import { a4WidthDpi, enhanceDocument } from "./imageFilters";

function image(values: [number, number, number][]): Uint8ClampedArray {
  const data = new Uint8ClampedArray(values.length * 4);
  values.forEach(([r, g, b], i) => data.set([r, g, b, 255], i * 4));
  return data;
}

describe("enhanceDocument", () => {
  it("turns a dim grey photo into black ink on white paper", () => {
    // 90% "paper" at a dull grey-yellow, 10% "ink" at a dark grey.
    const pixels: [number, number, number][] = [...Array(90).fill([170, 165, 140]), ...Array(10).fill([70, 70, 75])];
    const data = image(pixels);
    enhanceDocument(data);
    expect(data[0]).toBe(255); // paper -> white
    expect(data[90 * 4]).toBe(0); // ink -> black
    expect(data[0]).toBe(data[1]); // greyscale
    expect(data[3]).toBe(255); // alpha untouched
  });

  it("leaves a flat image without crashing", () => {
    const data = image(Array(10).fill([128, 128, 128]));
    enhanceDocument(data);
    expect([...data.slice(0, 3)].every((v) => v >= 0 && v <= 255)).toBe(true);
  });
});

describe("a4WidthDpi", () => {
  it("fits common capture widths to an A4 page width", () => {
    expect(a4WidthDpi(2480)).toBe(300);
    expect(a4WidthDpi(1920)).toBe(232);
    expect(a4WidthDpi(100)).toBe(72);
  });
});
