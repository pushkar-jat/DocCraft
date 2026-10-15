import { PDFDocument } from "pdf-lib";
import { DocError, throwIfCancelled } from "./errors";
import { MIN_FILES_TO_MERGE } from "./selection";

export interface PdfInput {
  /** Display name only (no directory), used in error messages. */
  name: string;
  bytes: Uint8Array;
}

export interface MergeProgress {
  stage: "reading" | "merging" | "saving";
  /** 1-based index of the file being processed; equals `total` while saving. */
  current: number;
  total: number;
}

export interface MergeOptions {
  signal?: AbortSignal;
  onProgress?: (progress: MergeProgress) => void;
}

export interface MergeResult {
  bytes: Uint8Array;
  pageCount: number;
}

/** PDF 1.x/2.x files must start with `%PDF-`; readers tolerate up to 1 KB of leading junk. */
export function hasPdfHeader(bytes: Uint8Array): boolean {
  const limit = Math.min(bytes.length, 1024) - 5;
  for (let i = 0; i <= limit; i++) {
    if (
      bytes[i] === 0x25 && // %
      bytes[i + 1] === 0x50 && // P
      bytes[i + 2] === 0x44 && // D
      bytes[i + 3] === 0x46 && // F
      bytes[i + 4] === 0x2d // -
    ) {
      return true;
    }
  }
  return false;
}

/** Lets the UI repaint and register a Cancel click between expensive steps. */
export const yieldToEventLoop = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

export async function loadPdf(input: PdfInput): Promise<PDFDocument> {
  if (!hasPdfHeader(input.bytes)) {
    throw new DocError("not-pdf", `"${input.name}" is not a valid PDF file.`, input.name);
  }
  let document: PDFDocument;
  try {
    // pdf-lib is compiled to ES5, so `instanceof EncryptedPDFError` is unreliable. Load with
    // ignoreEncryption and check `isEncrypted` explicitly instead. updateMetadata: false keeps
    // the in-memory copy's metadata untouched; the source file on disk is never written.
    document = await PDFDocument.load(input.bytes, { ignoreEncryption: true, updateMetadata: false });
  } catch {
    throw new DocError("not-pdf", `"${input.name}" is damaged or is not a valid PDF file.`, input.name);
  }
  if (document.isEncrypted) {
    // pdf-lib cannot decrypt, so copying pages would produce unreadable output.
    throw new DocError(
      "encrypted",
      `"${input.name}" is password-protected or encrypted. Remove the protection in a PDF reader you trust, then try again.`,
      input.name,
    );
  }
  return document;
}

/**
 * Merges the inputs into a new PDF, keeping every page in input order.
 * Runs entirely in memory; the caller decides where (and whether) to write the result.
 */
export async function mergePdfs(inputs: readonly PdfInput[], options: MergeOptions = {}): Promise<MergeResult> {
  const { signal, onProgress } = options;
  if (inputs.length < MIN_FILES_TO_MERGE) {
    throw new DocError("not-enough-files", `Select at least ${MIN_FILES_TO_MERGE} PDF files to merge.`);
  }
  throwIfCancelled(signal);

  const output = await PDFDocument.create();
  output.setProducer("DocCraft");
  output.setCreator("DocCraft");

  for (const [index, input] of inputs.entries()) {
    onProgress?.({ stage: "merging", current: index + 1, total: inputs.length });
    await yieldToEventLoop();
    throwIfCancelled(signal);

    const source = await loadPdf(input);
    const pageIndices = source.getPageIndices();
    if (pageIndices.length === 0) {
      throw new DocError("empty", `"${input.name}" does not contain any pages.`, input.name);
    }

    let pages;
    try {
      pages = await output.copyPages(source, pageIndices);
    } catch {
      throw new DocError(
        "unsupported",
        `"${input.name}" uses a PDF structure DocCraft cannot merge yet.`,
        input.name,
      );
    }
    for (const page of pages) {
      output.addPage(page);
    }
  }

  await yieldToEventLoop();
  throwIfCancelled(signal);
  onProgress?.({ stage: "saving", current: inputs.length, total: inputs.length });
  const bytes = await output.save();
  return { bytes, pageCount: output.getPageCount() };
}
