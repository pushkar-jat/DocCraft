import { DocError, throwIfCancelled } from "./errors";
import { extractFragments, type ExtractOptions, type PdfJsLike } from "./pdfToDocx";
import { compareLines, type Comparison, type Line } from "./textDiff";
import { pageLines } from "./textLayout";

export interface DocumentComparison extends Comparison {
  pagesA: number;
  pagesB: number;
}

async function linesOf(pdfjs: PdfJsLike, input: { name: string; bytes: Uint8Array }, options: ExtractOptions): Promise<{ lines: Line[]; pages: number }> {
  const { pages } = await extractFragments(pdfjs, input.bytes, input.name, options);
  const lines = pages.flatMap((fragments, index) => pageLines(fragments).map((text) => ({ text, page: index + 1 })));
  return { lines, pages: pages.length };
}

/** Compares the text of two PDFs line by line. Scanned PDFs (no text) are refused with guidance. */
export async function compareDocuments(
  pdfjs: PdfJsLike,
  a: { name: string; bytes: Uint8Array },
  b: { name: string; bytes: Uint8Array },
  options: ExtractOptions = {},
): Promise<DocumentComparison> {
  const first = await linesOf(pdfjs, a, options);
  throwIfCancelled(options.signal);
  const second = await linesOf(pdfjs, b, options);
  for (const [doc, input] of [[first, a], [second, b]] as const) {
    if (doc.lines.length === 0) {
      throw new DocError("no-text", `"${input.name}" has no selectable text — it is probably a scan. Run "OCR PDF" on it first, then compare.`, input.name);
    }
  }
  throwIfCancelled(options.signal);
  const comparison = compareLines(first.lines, second.lines);
  if (!comparison) {
    throw new DocError("unsupported", "These documents are too different to compare line by line (more than 20,000 changed lines).");
  }
  return { ...comparison, pagesA: first.pages, pagesB: second.pages };
}
