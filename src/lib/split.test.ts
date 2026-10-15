import { describe, expect, it } from "vitest";
import { makePdf, pageWidths, textBytes } from "../test/fixtures";
import { CancelledError, DocError } from "./errors";
import { parsePageRanges } from "./pageRanges";
import { extractPages, pageCountOf, splitPdf } from "./split";

const ranges = (text: string, pageCount: number) => {
  const result = parsePageRanges(text, pageCount);
  if (!result.ok) throw new Error(result.error);
  return result.ranges;
};

describe("splitPdf", () => {
  it("creates one output per range with the expected pages in order", async () => {
    const input = { name: "ten.pdf", bytes: await makePdf(1, 10) };
    const outputs = await splitPdf(input, ranges("1-3, 5, 8-10", 10));
    expect(outputs).toHaveLength(3);
    expect(await pageWidths(outputs[0])).toEqual([100, 101, 102]);
    expect(await pageWidths(outputs[1])).toEqual([104]);
    expect(await pageWidths(outputs[2])).toEqual([107, 108, 109]);
  });

  it("does not modify the source bytes", async () => {
    const bytes = await makePdf(1, 4);
    const snapshot = Uint8Array.from(bytes);
    await splitPdf({ name: "a.pdf", bytes }, ranges("1-2, 3-4", 4));
    expect(bytes).toEqual(snapshot);
  });

  it("stops when cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    const input = { name: "a.pdf", bytes: await makePdf(1, 4) };
    await expect(splitPdf(input, ranges("1, 2", 4), { signal: controller.signal })).rejects.toBeInstanceOf(CancelledError);
  });
});

describe("extractPages", () => {
  it("keeps the exact requested order 3, 1, 2", async () => {
    const input = { name: "three.pdf", bytes: await makePdf(1, 3) };
    const output = await extractPages(input, ranges("3, 1, 2", 3));
    expect(await pageWidths(output)).toEqual([102, 100, 101]);
  });

  it("rejects pages that do not exist", async () => {
    const input = { name: "two.pdf", bytes: await makePdf(1, 2) };
    await expect(extractPages(input, [{ start: 3, end: 3 }])).rejects.toMatchObject({ code: "invalid-range" });
  });

  it("rejects invalid PDFs", async () => {
    const error = await extractPages({ name: "fake.pdf", bytes: textBytes("nope") }, [{ start: 1, end: 1 }]).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DocError);
    expect((error as DocError).code).toBe("not-pdf");
  });
});

describe("pageCountOf", () => {
  it("returns the page count", async () => {
    expect(await pageCountOf({ name: "a.pdf", bytes: await makePdf(1, 7) })).toBe(7);
  });
});
