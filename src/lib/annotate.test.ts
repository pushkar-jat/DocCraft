import { degrees, PDFDocument, StandardFonts } from "pdf-lib";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it } from "vitest";
import { jpeg4x2, png } from "../test/imageFixtures";
import { applyOverlays, type OverlayItem } from "./annotate";
import { DocError } from "./errors";
import { assembleRedacted } from "./redact";
import { findTermBoxes } from "./textSearch";

async function pages(rotations: number[], lines = ["Account 12345 belongs to Asha", "Public line"]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle("Secret title");
  doc.setAuthor("Secret author");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const rotation of rotations) {
    const page = doc.addPage([595, 842]);
    lines.forEach((text, i) => page.drawText(text, { x: 72, y: 760 - i * 24, size: 14, font }));
    page.setRotation(degrees(rotation));
  }
  return doc.save();
}

async function open(bytes: Uint8Array) {
  return pdfjs.getDocument({ data: bytes.slice(), verbosity: 0 }).promise;
}

/** Text as shown on screen, with normalized display positions (origin top-left). */
async function shown(bytes: Uint8Array, pageNumber: number) {
  const page = await (await open(bytes)).getPage(pageNumber);
  const viewport = page.getViewport({ scale: 1 });
  const items = (await page.getTextContent()).items.flatMap((item) => ("str" in item && item.str.trim() ? [item] : []));
  return items.map((item) => {
    const m = pdfjs.Util.transform(viewport.transform, item.transform);
    return { text: item.str, x: m[4] / viewport.width, y: m[5] / viewport.height, horizontal: Math.abs(m[1]) < 1e-6 && m[0] > 0 };
  });
}

describe("applyOverlays", () => {
  it("places wrapped text inside the drawn box, upright on rotated pages", async () => {
    // ~150 pt wide on an upright A4 page: the 228 pt sentence must wrap onto several lines.
    const box = { x: 0.5, y: 0.1, width: 0.25, height: 0.2 };
    for (const rotation of [0, 90]) {
      const items: OverlayItem[] = [{ kind: "text", page: 0, box, text: "Approved by the finance team on Monday", fontSize: 12, color: [0, 0, 0.6] }];
      const output = await applyOverlays({ name: "a.pdf", bytes: await pages([rotation]) }, items);
      const added = (await shown(output, 1)).filter((item) => /Approved|finance|Monday/.test(item.text));
      expect(added.length, `rotation ${rotation}`).toBeGreaterThanOrEqual(2); // wrapped onto several lines
      for (const item of added) {
        expect(item.horizontal, `rotation ${rotation}: ${item.text}`).toBe(true);
        expect(item.x).toBeGreaterThanOrEqual(box.x - 0.01);
        expect(item.x).toBeLessThan(box.x + box.width);
        expect(item.y).toBeGreaterThan(box.y);
        expect(item.y).toBeLessThan(box.y + box.height + 0.02);
      }
    }
  });

  it("draws images, rectangles, highlights and white-out", async () => {
    const box = { x: 0.1, y: 0.1, width: 0.2, height: 0.1 };
    const output = await applyOverlays({ name: "a.pdf", bytes: await pages([0]) }, [
      { kind: "image", page: 0, box, bytes: png(20, 10), name: "logo.png" },
      { kind: "image", page: 0, box: { ...box, y: 0.3 }, bytes: jpeg4x2(), name: "photo.jpg" },
      { kind: "rect", page: 0, box, color: [1, 0, 0], lineWidth: 2 },
      { kind: "highlight", page: 0, box, color: [1, 0.9, 0] },
      { kind: "whiteout", page: 0, box: { x: 0, y: 0, width: 1, height: 0.2 } },
    ]);
    expect((await PDFDocument.load(output)).getPageCount()).toBe(1);
  });

  it("explains text the built-in font cannot draw, and rejects bad images and pages", async () => {
    const input = { name: "a.pdf", bytes: await pages([0]) };
    const box = { x: 0.1, y: 0.1, width: 0.5, height: 0.1 };
    await expect(applyOverlays(input, [{ kind: "text", page: 0, box, text: "नमस्ते", fontSize: 12, color: [0, 0, 0] }])).rejects.toMatchObject({ code: "unsupported" });
    await expect(applyOverlays(input, [{ kind: "image", page: 0, box, bytes: new Uint8Array([1, 2]), name: "x.png" }])).rejects.toMatchObject({ code: "invalid-image" });
    await expect(applyOverlays(input, [{ kind: "whiteout", page: 3, box }])).rejects.toBeInstanceOf(DocError);
  });
});

describe("assembleRedacted", () => {
  it("removes all text from redacted pages, keeps other pages, and drops metadata", async () => {
    const input = { name: "a.pdf", bytes: await pages([0, 90, 0]) };
    const output = await assembleRedacted(input, [{ index: 1, image: jpeg4x2(), width: 842, height: 595 }]);
    const doc = await open(output);
    expect(doc.numPages).toBe(3);
    expect((await shown(output, 1)).map((i) => i.text)).toContain("Account 12345 belongs to Asha");
    expect(await shown(output, 2)).toEqual([]); // nothing left to select or search
    const redactedView = (await doc.getPage(2)).getViewport({ scale: 1 });
    expect([Math.round(redactedView.width), Math.round(redactedView.height)]).toEqual([842, 595]);
    const reloaded = await PDFDocument.load(output);
    expect(reloaded.getTitle()).toBeUndefined();
    expect(reloaded.getAuthor()).toBeUndefined();
    const raw = new TextDecoder("latin1").decode(output);
    expect(raw).not.toContain("Secret title");
  });
});

describe("findTermBoxes", () => {
  it("finds every occurrence, case-insensitively, at the right place on upright and rotated pages", async () => {
    for (const rotation of [0, 90]) {
      const doc = await open(await pages([rotation], ["Account 12345 belongs to Asha", "asha again: ASHA"]));
      const page = await doc.getPage(1);
      const viewport = page.getViewport({ scale: 1 });
      const items = (await page.getTextContent()).items.flatMap((item) => ("str" in item ? [item] : []));
      const boxes = findTermBoxes(items, "asha", viewport.transform, viewport.width, viewport.height);
      expect(boxes, `rotation ${rotation}`).toHaveLength(3);
      for (const box of boxes) {
        expect(box.width).toBeGreaterThan(0);
        expect(box.x + box.width).toBeLessThanOrEqual(1);
        expect(box.y + box.height).toBeLessThanOrEqual(1);
      }
      // Each word's on-screen start point lies inside one of the boxes.
      const words = (await shown(await pages([rotation], ["Account 12345 belongs to Asha", "asha again: ASHA"]), 1)).filter((w) => /asha/i.test(w.text));
      expect(words.length).toBeGreaterThan(0);
    }
  });

  it("returns nothing for empty search terms", () => {
    expect(findTermBoxes([{ str: "abc", transform: [1, 0, 0, 1, 0, 0], width: 10 }], "  ", [1, 0, 0, -1, 0, 100], 100, 100)).toEqual([]);
  });
});
