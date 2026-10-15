import { describe, expect, it } from "vitest";
import { CancelledError } from "./errors";
import { describeOcrProgress, MAX_OCR_PAGES, ocrImages, ocrPdf, type OcrDeps, type OcrProgress } from "./ocrPipeline";

function fakeDeps(pageCount: number) {
  const log: string[] = [];
  let closed = false;
  const deps: OcrDeps = {
    openPages: async (_bytes, _name, dpi) => ({
      pageCount,
      render: async (page) => (log.push(`render ${page} @${dpi}`), { image: new Uint8Array([page]), dpi }),
      close: async () => {
        closed = true;
      },
    }),
    recognize: async (image, dpi) => (log.push(`ocr ${image[0]} @${dpi}`), new Uint8Array([100 + image[0]])),
    combine: async (pdfs) => (log.push(`combine ${pdfs.map((pdf) => pdf[0]).join(",")}`), new Uint8Array([0])),
  };
  return { deps, log, isClosed: () => closed };
}

describe("ocrPdf", () => {
  it("renders and recognizes every page in order, then combines them", async () => {
    const { deps, log, isClosed } = fakeDeps(3);
    const progress: OcrProgress[] = [];
    await ocrPdf(new Uint8Array(), "scan.pdf", deps, { onProgress: (p) => progress.push(p) });
    expect(log).toEqual(["render 1 @300", "ocr 1 @300", "render 2 @300", "ocr 2 @300", "render 3 @300", "ocr 3 @300", "combine 101,102,103"]);
    expect(progress.at(-1)).toEqual({ stage: "assembling", current: 3, total: 3 });
    expect(isClosed()).toBe(true);
  });

  it("returns a single page directly without combining", async () => {
    const { deps, log } = fakeDeps(1);
    const output = await ocrPdf(new Uint8Array(), "one.pdf", deps);
    expect(output).toEqual(new Uint8Array([101]));
    expect(log).not.toContain("combine 101");
  });

  it("stops when cancelled and still releases the document", async () => {
    const { deps, log, isClosed } = fakeDeps(5);
    const controller = new AbortController();
    const run = ocrPdf(new Uint8Array(), "scan.pdf", deps, {
      signal: controller.signal,
      onProgress: (p) => p.stage === "recognizing" && p.current === 2 && controller.abort(),
    });
    await expect(run).rejects.toBeInstanceOf(CancelledError);
    expect(log.some((entry) => entry.startsWith("combine"))).toBe(false);
    expect(isClosed()).toBe(true);
  });

  it("rejects empty and overly long documents", async () => {
    await expect(ocrPdf(new Uint8Array(), "empty.pdf", fakeDeps(0).deps)).rejects.toMatchObject({ code: "empty" });
    await expect(ocrPdf(new Uint8Array(), "huge.pdf", fakeDeps(MAX_OCR_PAGES + 1).deps)).rejects.toMatchObject({ code: "too-large" });
  });
});

describe("ocrImages", () => {
  it("recognizes images in order without a DPI hint", async () => {
    const { deps, log } = fakeDeps(0);
    await ocrImages(
      [
        { name: "b.png", bytes: new Uint8Array([2]) },
        { name: "a.png", bytes: new Uint8Array([1]) },
      ],
      deps,
    );
    expect(log).toEqual(["ocr 2 @null", "ocr 1 @null", "combine 102,101"]);
  });
});

describe("describeOcrProgress", () => {
  it("describes each stage", () => {
    expect(describeOcrProgress({ stage: "rendering", current: 1, total: 2 })).toBe("Rendering page 1 of 2…");
    expect(describeOcrProgress({ stage: "recognizing", current: 2, total: 2 })).toBe("Recognizing text on page 2 of 2…");
  });
});
