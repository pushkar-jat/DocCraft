import { DocError, throwIfCancelled } from "./errors";

export interface OcrProgress {
  stage: "rendering" | "recognizing" | "assembling";
  current: number;
  total: number;
}

export interface OcrDeps {
  /** Page count and a renderer producing a JPEG/PNG of each page at (up to) `dpi`, with the DPI actually used. */
  openPages(
    bytes: Uint8Array,
    name: string,
    dpi: number,
  ): Promise<{ pageCount: number; render(page: number): Promise<{ image: Uint8Array; dpi: number }>; close(): Promise<void> }>;
  /** Image -> one-page searchable PDF (local Tesseract). */
  recognize(image: Uint8Array, dpi: number | null, signal?: AbortSignal): Promise<Uint8Array>;
  /** Combines one-page PDFs in order. */
  combine(pdfs: Uint8Array[], signal?: AbortSignal): Promise<Uint8Array>;
}

export interface OcrOptions {
  dpi?: number;
  signal?: AbortSignal;
  onProgress?: (progress: OcrProgress) => void;
}

export const OCR_DPI = 300;
/** Rendering every page of very long documents at 300 dpi takes a long time; cap per run. */
export const MAX_OCR_PAGES = 500;

/** Scanned PDF -> searchable PDF: render each page locally, OCR it, then combine the pages. */
export async function ocrPdf(bytes: Uint8Array, name: string, deps: OcrDeps, options: OcrOptions = {}): Promise<Uint8Array> {
  const dpi = options.dpi ?? OCR_DPI;
  const document = await deps.openPages(bytes, name, dpi);
  try {
    if (document.pageCount === 0) {
      throw new DocError("empty", `"${name}" does not contain any pages.`, name);
    }
    if (document.pageCount > MAX_OCR_PAGES) {
      throw new DocError("too-large", `"${name}" has ${document.pageCount} pages. OCR is limited to ${MAX_OCR_PAGES} pages per file.`, name);
    }
    const pages: Uint8Array[] = [];
    for (let page = 1; page <= document.pageCount; page++) {
      throwIfCancelled(options.signal);
      options.onProgress?.({ stage: "rendering", current: page, total: document.pageCount });
      const rendered = await document.render(page);
      throwIfCancelled(options.signal);
      options.onProgress?.({ stage: "recognizing", current: page, total: document.pageCount });
      pages.push(await deps.recognize(rendered.image, rendered.dpi, options.signal));
    }
    throwIfCancelled(options.signal);
    options.onProgress?.({ stage: "assembling", current: document.pageCount, total: document.pageCount });
    return pages.length === 1 ? pages[0] : await deps.combine(pages, options.signal);
  } finally {
    await document.close();
  }
}

/** Images -> one searchable PDF (one page per image, in order). */
export async function ocrImages(
  images: { name: string; bytes: Uint8Array }[],
  deps: Pick<OcrDeps, "recognize" | "combine">,
  options: Omit<OcrOptions, "dpi"> = {},
): Promise<Uint8Array> {
  if (images.length === 0) {
    throw new DocError("not-enough-files", "Add at least one image.");
  }
  const pages: Uint8Array[] = [];
  for (const [index, image] of images.entries()) {
    throwIfCancelled(options.signal);
    options.onProgress?.({ stage: "recognizing", current: index + 1, total: images.length });
    pages.push(await deps.recognize(image.bytes, null, options.signal));
  }
  throwIfCancelled(options.signal);
  options.onProgress?.({ stage: "assembling", current: images.length, total: images.length });
  return pages.length === 1 ? pages[0] : await deps.combine(pages, options.signal);
}

export function describeOcrProgress(progress: OcrProgress): string {
  switch (progress.stage) {
    case "rendering":
      return `Rendering page ${progress.current} of ${progress.total}…`;
    case "recognizing":
      return `Recognizing text on page ${progress.current} of ${progress.total}…`;
    case "assembling":
      return "Assembling the searchable PDF…";
  }
}
