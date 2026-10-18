import { PDFDocument, StandardFonts } from "pdf-lib";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it } from "vitest";
import { compareDocuments } from "./compare";
import type { PdfJsLike } from "./pdfToDocx";
import { compareLines, comparisonReport, myersDiff, wordDiff, type Line } from "./textDiff";

const apply = (a: string[], b: string[]) => {
  const ops = myersDiff(a, b, (x, y) => x === y)!;
  // Rebuild both sides from the script to prove it is a valid edit script.
  expect(ops.filter((op) => op.kind !== "insert").map((op) => op.item)).toEqual(a);
  expect(ops.filter((op) => op.kind !== "delete").map((op) => op.item)).toEqual(b);
  return ops;
};

describe("myersDiff", () => {
  it("produces a minimal valid edit script", () => {
    const ops = apply("ABCABBA".split(""), "CBABAC".split(""));
    expect(ops.filter((op) => op.kind !== "equal")).toHaveLength(5); // classic example: D = 5
  });

  it("handles empty, identical and fully different inputs", () => {
    expect(apply([], [])).toEqual([]);
    expect(apply(["x"], ["x"]).every((op) => op.kind === "equal")).toBe(true);
    expect(apply(["a", "b"], ["c"]).filter((op) => op.kind === "equal")).toHaveLength(0);
    expect(apply([], ["n"])).toEqual([{ kind: "insert", item: "n" }]);
  });

  it("gives up on inputs differing by more than the limit", () => {
    expect(myersDiff(["a", "b", "c"], ["x", "y", "z"], (x, y) => x === y, 2)).toBeNull();
  });
});

describe("compareLines", () => {
  const lines = (texts: string[], page = 1): Line[] => texts.map((text) => ({ text, page }));

  it("groups changes into hunks and ignores whitespace and case", () => {
    const result = compareLines(lines(["Title", "Price: 10 EUR", "Same", "Old ending"]), lines(["title", "Price: 12 EUR", "Same  ", "Old ending", "New line"]))!;
    expect(result.identical).toBe(false);
    expect(result.hunks).toEqual([
      { removed: [{ text: "Price: 10 EUR", page: 1 }], added: [{ text: "Price: 12 EUR", page: 1 }] },
      { removed: [], added: [{ text: "New line", page: 1 }] },
    ]);
    expect(result.unchangedLines).toBe(3);
    expect(comparisonReport("a.pdf", "b.pdf", result)).toContain("+ [p.1] New line");
  });

  it("reports identical documents", () => {
    expect(compareLines(lines(["x"]), lines(["x"]))!.identical).toBe(true);
  });
});

describe("wordDiff", () => {
  it("highlights only the changed words", () => {
    const { before, after } = wordDiff("Total due: 10 EUR today", "Total due: 12 EUR today");
    expect(before.filter((p) => p.changed).map((p) => p.text)).toEqual(["10"]);
    expect(after.filter((p) => p.changed).map((p) => p.text)).toEqual(["12"]);
  });
});

describe("compareDocuments", () => {
  async function pdf(pages: string[][]): Promise<Uint8Array> {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    for (const lines of pages) {
      const page = doc.addPage([595, 842]);
      lines.forEach((text, index) => page.drawText(text, { x: 72, y: 760 - index * 20, size: 12, font }));
    }
    return doc.save();
  }

  it("finds the changed line and its page in real PDFs", async () => {
    const a = await pdf([["Contract", "Fee: 100 EUR"], ["Signed by Alice"]]);
    const b = await pdf([["Contract", "Fee: 150 EUR"], ["Signed by Alice"]]);
    const result = await compareDocuments(pdfjs as unknown as PdfJsLike, { name: "a.pdf", bytes: a }, { name: "b.pdf", bytes: b }, { documentParams: { verbosity: 0 } });
    expect(result.hunks).toEqual([{ removed: [{ text: "Fee: 100 EUR", page: 1 }], added: [{ text: "Fee: 150 EUR", page: 1 }] }]);
    expect(result.pagesA).toBe(2);
  });
});
