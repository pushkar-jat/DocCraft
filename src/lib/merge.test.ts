import { describe, expect, it } from "vitest";
import { makeEmptyPdf, makeEncryptedPdf, makePdf, pageWidths, textBytes } from "../test/fixtures";
import { MergeCancelledError, MergeError } from "./errors";
import { hasPdfHeader, mergePdfs, type MergeProgress } from "./merge";

async function expectMergeError(promise: Promise<unknown>, code: string, fileName?: string) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(MergeError);
  expect((error as MergeError).code).toBe(code);
  if (fileName !== undefined) {
    expect((error as MergeError).fileName).toBe(fileName);
    expect((error as MergeError).message).toContain(fileName);
  }
}

describe("mergePdfs", () => {
  it("output page count equals the sum of input page counts", async () => {
    const inputs = [
      { name: "one.pdf", bytes: await makePdf(1, 2) },
      { name: "two.pdf", bytes: await makePdf(2, 3) },
      { name: "three.pdf", bytes: await makePdf(3, 1) },
    ];
    const result = await mergePdfs(inputs);
    expect(result.pageCount).toBe(6);
    expect(await pageWidths(result.bytes)).toHaveLength(6);
  });

  it("keeps pages in input order", async () => {
    const one = { name: "one.pdf", bytes: await makePdf(1, 2) };
    const two = { name: "two.pdf", bytes: await makePdf(2, 3) };

    expect(await pageWidths((await mergePdfs([one, two])).bytes)).toEqual([100, 101, 200, 201, 202]);
    expect(await pageWidths((await mergePdfs([two, one])).bytes)).toEqual([200, 201, 202, 100, 101]);
  });

  it("produces a PDF that starts with a PDF header and reloads cleanly", async () => {
    const result = await mergePdfs([
      { name: "a.pdf", bytes: await makePdf(1, 1) },
      { name: "b.pdf", bytes: await makePdf(2, 1) },
    ]);
    expect(hasPdfHeader(result.bytes)).toBe(true);
    expect(await pageWidths(result.bytes)).toEqual([100, 200]);
  });

  it("does not modify the input buffers", async () => {
    const bytes = await makePdf(1, 2);
    const snapshot = Uint8Array.from(bytes);
    await mergePdfs([
      { name: "a.pdf", bytes },
      { name: "b.pdf", bytes: await makePdf(2, 1) },
    ]);
    expect(bytes).toEqual(snapshot);
  });

  it("requires at least two inputs", async () => {
    await expectMergeError(mergePdfs([]), "not-enough-files");
    await expectMergeError(mergePdfs([{ name: "a.pdf", bytes: await makePdf(1, 1) }]), "not-enough-files");
  });

  it("rejects a non-PDF file renamed to .pdf", async () => {
    const inputs = [
      { name: "good.pdf", bytes: await makePdf(1, 1) },
      { name: "renamed.pdf", bytes: textBytes("This is just a text file.") },
    ];
    await expectMergeError(mergePdfs(inputs), "not-pdf", "renamed.pdf");
  });

  it("rejects a damaged PDF", async () => {
    const inputs = [
      { name: "good.pdf", bytes: await makePdf(1, 1) },
      { name: "broken.pdf", bytes: textBytes("%PDF-1.7\n1 0 obj << /Type /Catalog") },
    ];
    await expectMergeError(mergePdfs(inputs), "not-pdf", "broken.pdf");
  });

  it("rejects a truncated PDF", async () => {
    const full = await makePdf(2, 2);
    const inputs = [
      { name: "good.pdf", bytes: await makePdf(1, 1) },
      { name: "truncated.pdf", bytes: full.slice(0, 40) },
    ];
    await expectMergeError(mergePdfs(inputs), "not-pdf", "truncated.pdf");
  });

  it("rejects encrypted PDFs with a helpful message", async () => {
    const inputs = [
      { name: "good.pdf", bytes: await makePdf(1, 1) },
      { name: "secret.pdf", bytes: await makeEncryptedPdf() },
    ];
    await expectMergeError(mergePdfs(inputs), "encrypted", "secret.pdf");
  });

  it("rejects a PDF without pages", async () => {
    const inputs = [
      { name: "good.pdf", bytes: await makePdf(1, 1) },
      { name: "blank.pdf", bytes: await makeEmptyPdf() },
    ];
    await expectMergeError(mergePdfs(inputs), "empty", "blank.pdf");
  });

  it("stops before doing any work when already cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    const inputs = [
      { name: "a.pdf", bytes: await makePdf(1, 1) },
      { name: "b.pdf", bytes: await makePdf(2, 1) },
    ];
    await expect(mergePdfs(inputs, { signal: controller.signal })).rejects.toBeInstanceOf(MergeCancelledError);
  });

  it("stops when cancelled part-way through", async () => {
    const controller = new AbortController();
    const seen: MergeProgress[] = [];
    const inputs = [
      { name: "a.pdf", bytes: await makePdf(1, 1) },
      { name: "b.pdf", bytes: await makePdf(2, 1) },
      { name: "c.pdf", bytes: await makePdf(3, 1) },
    ];
    const run = mergePdfs(inputs, {
      signal: controller.signal,
      onProgress: (progress) => {
        seen.push(progress);
        if (progress.current === 2) controller.abort();
      },
    });
    await expect(run).rejects.toBeInstanceOf(MergeCancelledError);
    expect(seen.some((progress) => progress.stage === "saving")).toBe(false);
  });

  it("reports progress for each file and then saving", async () => {
    const seen: MergeProgress[] = [];
    await mergePdfs(
      [
        { name: "a.pdf", bytes: await makePdf(1, 1) },
        { name: "b.pdf", bytes: await makePdf(2, 1) },
      ],
      { onProgress: (progress) => seen.push(progress) },
    );
    expect(seen).toEqual([
      { stage: "merging", current: 1, total: 2 },
      { stage: "merging", current: 2, total: 2 },
      { stage: "saving", current: 2, total: 2 },
    ]);
  });
});

describe("hasPdfHeader", () => {
  it("finds the header at the start or after a little leading junk", () => {
    expect(hasPdfHeader(textBytes("%PDF-1.7"))).toBe(true);
    expect(hasPdfHeader(textBytes("\r\n  %PDF-1.4"))).toBe(true);
  });

  it("rejects data without a header", () => {
    expect(hasPdfHeader(textBytes(""))).toBe(false);
    expect(hasPdfHeader(textBytes("PK\u0003\u0004 docx zip"))).toBe(false);
    expect(hasPdfHeader(textBytes(" ".repeat(2000) + "%PDF-1.7"))).toBe(false);
  });
});
