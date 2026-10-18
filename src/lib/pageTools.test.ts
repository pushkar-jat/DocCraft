import { degrees, PDFDocument, StandardFonts } from "pdf-lib";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it } from "vitest";
import { makePdf, pageWidths } from "../test/fixtures";
import { png } from "../test/imageFixtures";
import { CancelledError, DocError } from "./errors";
import {
  addPageNumbers,
  addWatermark,
  cropPages,
  formatPageNumber,
  organizePages,
  removePages,
  rotatePages,
  salvagePdf,
  tileCentres,
} from "./pageTools";

/** A4 pages with the given /Rotate values and a body line so pages are distinguishable. */
async function a4Pdf(rotations: number[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  rotations.forEach((rotation, index) => {
    const page = doc.addPage([595, 842]);
    page.drawText(`Body ${index + 1}`, { x: 100, y: 400, size: 12, font });
    page.setRotation(degrees(rotation));
  });
  return doc.save();
}

interface ShownText {
  text: string;
  /** Display coordinates, origin top-left, y down. */
  x: number;
  y: number;
  horizontal: boolean;
  pageWidth: number;
  pageHeight: number;
}

/** Text as it appears on screen (after /Rotate), via pdf.js. */
async function shownText(bytes: Uint8Array, pageNumber: number): Promise<ShownText[]> {
  const doc = await pdfjs.getDocument({ data: bytes.slice(), verbosity: 0 }).promise;
  const page = await doc.getPage(pageNumber);
  const viewport = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();
  const items = content.items.flatMap((item) => ("str" in item && item.str.trim() ? [item] : []));
  return items.map((item) => {
    const m = pdfjs.Util.transform(viewport.transform, item.transform);
    return { text: item.str, x: m[4], y: m[5], horizontal: Math.abs(m[1]) < 1e-6 && m[0] > 0, pageWidth: viewport.width, pageHeight: viewport.height };
  });
}

async function rotations(bytes: Uint8Array): Promise<number[]> {
  return (await PDFDocument.load(bytes)).getPages().map((page) => page.getRotation().angle);
}

describe("removePages", () => {
  it("removes the selected pages and keeps the rest in order", async () => {
    const output = await removePages({ name: "a.pdf", bytes: await makePdf(1, 5) }, [{ start: 2, end: 3 }]);
    expect(await pageWidths(output)).toEqual([100, 103, 104]);
  });

  it("refuses to remove every page", async () => {
    const error = await removePages({ name: "a.pdf", bytes: await makePdf(1, 2) }, [{ start: 1, end: 2 }]).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DocError);
    expect((error as DocError).message).toMatch(/at least one page/);
  });
});

describe("rotatePages", () => {
  it("rotates only the selected pages, adding to existing rotation", async () => {
    const output = await rotatePages({ name: "a.pdf", bytes: await a4Pdf([0, 90, 0]) }, [{ start: 2, end: 3 }], 90);
    expect(await rotations(output)).toEqual([0, 180, 90]);
  });

  it("rotates every page when no selection is given", async () => {
    expect(await rotations(await rotatePages({ name: "a.pdf", bytes: await a4Pdf([0, 270]) }, null, 180))).toEqual([180, 90]);
  });
});

describe("organizePages", () => {
  it("reorders, duplicates, rotates and inserts blank pages", async () => {
    const input = { name: "a.pdf", bytes: await makePdf(1, 3) };
    const output = await organizePages(input, [{ source: 2, rotate: 0 }, { blank: true }, { source: 0, rotate: 90 }, { source: 0, rotate: 0 }]);
    expect(await pageWidths(output)).toEqual([102, 102, 100, 100]);
    expect(await rotations(output)).toEqual([0, 0, 90, 0]);
  });

  it("rejects an empty result and unknown pages", async () => {
    const input = { name: "a.pdf", bytes: await makePdf(1, 2) };
    await expect(organizePages(input, [])).rejects.toMatchObject({ code: "invalid-range" });
    await expect(organizePages(input, [{ source: 5, rotate: 0 }])).rejects.toMatchObject({ code: "invalid-range" });
  });
});

describe("addPageNumbers", () => {
  it("formats numbers", () => {
    expect(formatPageNumber("n", 3, 9)).toBe("3");
    expect(formatPageNumber("page-n-of-total", 3, 9)).toBe("Page 3 of 9");
    expect(formatPageNumber("n-of-total", 1, 2)).toBe("1 / 2");
  });

  it("places readable numbers bottom-right on upright and rotated pages", async () => {
    const output = await addPageNumbers(
      { name: "a.pdf", bytes: await a4Pdf([0, 90, 180, 270]) },
      { selection: null, anchor: "bottom-right", format: "page-n-of-total", start: 1, fontSize: 10, margin: 30 },
    );
    for (let page = 1; page <= 4; page++) {
      const label = (await shownText(output, page)).find((item) => item.text.startsWith("Page "));
      expect(label?.text, `page ${page}`).toBe(`Page ${page} of 4`);
      expect(label!.horizontal, `page ${page} reads left-to-right`).toBe(true);
      expect(label!.x, `page ${page} right side`).toBeGreaterThan(label!.pageWidth * 0.6);
      expect(label!.y, `page ${page} bottom`).toBeGreaterThan(label!.pageHeight - 60);
    }
  });

  it("numbers only selected pages, starting from the given number", async () => {
    const output = await addPageNumbers(
      { name: "a.pdf", bytes: await a4Pdf([0, 0, 0]) },
      { selection: [{ start: 2, end: 3 }], anchor: "top-center", format: "n", start: 5, fontSize: 10, margin: 30 },
    );
    const numbersOn = async (page: number) => (await shownText(output, page)).filter((item) => /^\d+$/.test(item.text)).map((item) => item.text);
    expect(await numbersOn(1)).toEqual([]);
    expect(await numbersOn(2)).toEqual(["5"]);
    expect(await numbersOn(3)).toEqual(["6"]);
    const top = (await shownText(output, 2)).find((item) => item.text === "5")!;
    expect(top.y).toBeLessThan(60);
  });
});

describe("addWatermark", () => {
  it("adds centred text on every page, readable on rotated pages", async () => {
    const output = await addWatermark(
      { name: "a.pdf", bytes: await a4Pdf([0, 90]) },
      { selection: null, content: { kind: "text", text: "CONFIDENTIAL", fontSize: 48, color: [0.8, 0, 0] }, opacity: 0.3, angle: 0, layout: "center" },
    );
    for (const page of [1, 2]) {
      const mark = (await shownText(output, page)).find((item) => item.text === "CONFIDENTIAL");
      expect(mark, `page ${page}`).toBeDefined();
      expect(mark!.horizontal).toBe(true);
      expect(mark!.x).toBeGreaterThan(mark!.pageWidth * 0.1);
      expect(mark!.x).toBeLessThan(mark!.pageWidth * 0.5);
    }
  });

  it("tiles an image watermark and rejects invalid images", async () => {
    const input = { name: "a.pdf", bytes: await a4Pdf([0]) };
    const output = await addWatermark(input, {
      selection: null,
      content: { kind: "image", bytes: png(20, 10), name: "logo.png", scale: 0.2 },
      opacity: 0.4,
      angle: 30,
      layout: "tile",
    });
    expect((await PDFDocument.load(output)).getPageCount()).toBe(1);
    await expect(
      addWatermark(input, { selection: null, content: { kind: "image", bytes: new Uint8Array([1, 2, 3]), name: "x.png", scale: 0.2 }, opacity: 0.4, angle: 0, layout: "center" }),
    ).rejects.toMatchObject({ code: "invalid-image" });
    await expect(
      addWatermark(input, { selection: null, content: { kind: "text", text: "  ", fontSize: 40, color: [0, 0, 0] }, opacity: 0.4, angle: 0, layout: "center" }),
    ).rejects.toBeInstanceOf(DocError);
  });

  it("computes tile centres inside the page", () => {
    const centres = tileCentres(600, 800, 200);
    expect(centres.length).toBe(12);
    expect(centres.every(([x, y]) => x > 0 && x < 600 && y > 0 && y < 800)).toBe(true);
  });
});

describe("cropPages", () => {
  it("trims the visible page by display margins, also on rotated pages", async () => {
    const output = await cropPages({ name: "a.pdf", bytes: await a4Pdf([0, 90]) }, null, { top: 100, right: 0, bottom: 0, left: 50 });
    const doc = await pdfjs.getDocument({ data: output.slice(), verbosity: 0 }).promise;
    for (const page of [1, 2]) {
      const viewport = (await doc.getPage(page)).getViewport({ scale: 1 });
      const [fullW, fullH] = page === 1 ? [595, 842] : [842, 595];
      expect(Math.round(viewport.width), `page ${page}`).toBe(fullW - 50);
      expect(Math.round(viewport.height), `page ${page}`).toBe(fullH - 100);
    }
  });

  it("rejects margins larger than the page and negative margins", async () => {
    const input = { name: "a.pdf", bytes: await a4Pdf([0]) };
    await expect(cropPages(input, null, { top: 500, right: 0, bottom: 500, left: 0 })).rejects.toMatchObject({ code: "invalid-range" });
    await expect(cropPages(input, null, { top: -1, right: 0, bottom: 0, left: 0 })).rejects.toMatchObject({ code: "invalid-range" });
  });
});

describe("cancellation", () => {
  it("stops page tools when cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(rotatePages({ name: "a.pdf", bytes: await a4Pdf([0]) }, null, 90, { signal: controller.signal })).rejects.toBeInstanceOf(CancelledError);
  });
});

describe("salvagePdf", () => {
  /** Cuts the file at "startxref" (destroying the cross-reference pointer) and prepends junk, at byte level. */
  function breakXref(good: Uint8Array): Uint8Array {
    const marker = new TextEncoder().encode("startxref");
    let at = -1;
    for (let i = good.length - marker.length; i >= 0 && at < 0; i--) if (marker.every((b, j) => good[i + j] === b)) at = i;
    const tail = new TextEncoder().encode("startxref\n999999\n%%EOF");
    const junk = new TextEncoder().encode("JUNK\n");
    const out = new Uint8Array(junk.length + at + tail.length);
    out.set(junk, 0);
    out.set(good.subarray(0, at), junk.length);
    out.set(tail, junk.length + at);
    return out;
  }

  async function threePages(useObjectStreams: boolean): Promise<Uint8Array> {
    const doc = await PDFDocument.create();
    [100, 101, 102].forEach((width) => doc.addPage([width, 200]));
    return doc.save({ useObjectStreams });
  }

  it("recovers pages when the cross-reference table is destroyed (plain objects)", async () => {
    const result = await salvagePdf({ name: "broken.pdf", bytes: breakXref(await threePages(false)) });
    expect(result.pageCount).toBe(3);
    expect(await pageWidths(result.bytes)).toEqual([100, 101, 102]);
  });

  it("recovers pages when the cross-reference stream is destroyed (object streams)", async () => {
    const result = await salvagePdf({ name: "broken.pdf", bytes: breakXref(await threePages(true)) });
    expect(result.pageCount).toBe(3);
  });

  it("fails clearly when nothing is recoverable", async () => {
    await expect(salvagePdf({ name: "x.pdf", bytes: new TextEncoder().encode("%PDF-1.7\n nothing here") })).rejects.toBeInstanceOf(DocError);
  });
});
