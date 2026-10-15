import { PDFDocument } from "pdf-lib";
import { DocError, throwIfCancelled } from "./errors";
import { loadPdf, yieldToEventLoop, type PdfInput } from "./merge";
import { rangesToIndices, type PageRange } from "./pageRanges";

export interface PageProgress {
  current: number;
  total: number;
}

export interface SplitOptions {
  signal?: AbortSignal;
  onProgress?: (progress: PageProgress) => void;
}

export async function pageCountOf(input: PdfInput): Promise<number> {
  const doc = await loadPdf(input);
  const count = doc.getPageCount();
  if (count === 0) {
    throw new DocError("empty", `"${input.name}" does not contain any pages.`, input.name);
  }
  return count;
}

async function copyToNewDocument(source: PDFDocument, indices: number[], name: string): Promise<Uint8Array> {
  const output = await PDFDocument.create();
  output.setProducer("DocCraft");
  output.setCreator("DocCraft");
  try {
    const pages = await output.copyPages(source, indices);
    pages.forEach((page) => output.addPage(page));
  } catch {
    throw new DocError("unsupported", `"${name}" uses a PDF structure DocCraft cannot split yet.`, name);
  }
  return output.save();
}

function checkIndices(indices: number[], pageCount: number, name: string): void {
  if (indices.length === 0 || indices.some((index) => index < 0 || index >= pageCount)) {
    throw new DocError("invalid-range", `The selected pages do not exist in "${name}".`, name);
  }
}

/** One new PDF containing the selected pages in exactly the requested order. */
export async function extractPages(input: PdfInput, ranges: readonly PageRange[], options: SplitOptions = {}): Promise<Uint8Array> {
  throwIfCancelled(options.signal);
  const source = await loadPdf(input);
  const indices = rangesToIndices(ranges);
  checkIndices(indices, source.getPageCount(), input.name);
  options.onProgress?.({ current: 1, total: 1 });
  await yieldToEventLoop();
  throwIfCancelled(options.signal);
  return copyToNewDocument(source, indices, input.name);
}

/** One new PDF per range, in range order. */
export async function splitPdf(input: PdfInput, ranges: readonly PageRange[], options: SplitOptions = {}): Promise<Uint8Array[]> {
  throwIfCancelled(options.signal);
  const source = await loadPdf(input);
  const outputs: Uint8Array[] = [];
  for (const [index, range] of ranges.entries()) {
    options.onProgress?.({ current: index + 1, total: ranges.length });
    await yieldToEventLoop();
    throwIfCancelled(options.signal);
    const indices = rangesToIndices([range]);
    checkIndices(indices, source.getPageCount(), input.name);
    outputs.push(await copyToNewDocument(source, indices, input.name));
  }
  return outputs;
}
