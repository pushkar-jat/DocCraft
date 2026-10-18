import { PDFDocument } from "pdf-lib";
import { DocError, throwIfCancelled } from "./errors";
import { detectImageKind } from "./images";
import { loadPdf, type PdfInput } from "./merge";
import type { NormalizedBox } from "./pageGeometry";

export interface RedactedPage {
  /** 0-based page index in the original document. */
  index: number;
  /** Rendered page image with the redaction boxes burned in (JPEG or PNG). */
  image: Uint8Array;
  /** Visible page size in points (after rotation). */
  width: number;
  height: number;
}

/**
 * Builds a brand-new PDF: untouched pages are copied as they are, redacted pages are replaced by
 * their flattened images, so no text, vector content or annotation from under a box survives.
 * Because the document is new, the original's metadata, bookmarks, attachments and form data
 * are not carried over either.
 */
export async function assembleRedacted(input: PdfInput, redacted: readonly RedactedPage[], options: { signal?: AbortSignal } = {}): Promise<Uint8Array> {
  const source = await loadPdf(input);
  const count = source.getPageCount();
  const replaced = new Map(redacted.map((page) => [page.index, page]));
  if ([...replaced.keys()].some((index) => index < 0 || index >= count)) throw new DocError("invalid-range", "A redacted page does not exist.");

  const output = await PDFDocument.create();
  output.setProducer("DocCraft");
  output.setCreator("DocCraft");
  const keep = source.getPageIndices().filter((index) => !replaced.has(index));
  const copied = keep.length > 0 ? await output.copyPages(source, keep) : [];
  let next = 0;
  for (let index = 0; index < count; index++) {
    throwIfCancelled(options.signal);
    const page = replaced.get(index);
    if (!page) {
      output.addPage(copied[next++]);
      continue;
    }
    const kind = detectImageKind(page.image);
    const image = kind === "png" ? await output.embedPng(page.image) : await output.embedJpg(page.image);
    output.addPage([page.width, page.height]).drawImage(image, { x: 0, y: 0, width: page.width, height: page.height });
  }
  return output.save();
}

/** Pixel rectangle on a rendered page for a normalized box (for burning boxes into images). */
export function boxToPixels(box: NormalizedBox, canvasWidth: number, canvasHeight: number) {
  return { x: box.x * canvasWidth, y: box.y * canvasHeight, width: box.width * canvasWidth, height: box.height * canvasHeight };
}
