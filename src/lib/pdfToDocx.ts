import { buildDocx } from "./docxWriter";
import { DocError, throwIfCancelled } from "./errors";
import { countCharacters, layoutPage, type Paragraph, type TextFragment } from "./textLayout";

/** The subset of pdf.js this module uses, so the app and Node tests can pass their own build. */
export interface PdfJsLike {
  getDocument(params: Record<string, unknown>): { promise: Promise<PdfDocumentLike>; destroy(): Promise<void> };
}
export interface PdfDocumentLike {
  numPages: number;
  getPage(pageNumber: number): Promise<PdfPageLike>;
}
export interface PdfPageLike {
  view: number[];
  getTextContent(): Promise<{ items: unknown[] }>;
}

interface TextItemLike {
  str: string;
  transform: number[];
  width: number;
}

export interface ExtractedText {
  pages: Paragraph[][];
  /** First page size in points. */
  pageSize: { width: number; height: number };
  characterCount: number;
}

/** Below this many non-space characters per page on average, treat the PDF as a scan. */
export const MIN_CHARACTERS_PER_PAGE = 16;

function isTextItem(item: unknown): item is TextItemLike {
  return typeof item === "object" && item !== null && "str" in item && "transform" in item;
}

export function toFragments(items: readonly unknown[]): TextFragment[] {
  return items.filter(isTextItem).map((item) => {
    const [a, b, c, d, x, y] = item.transform;
    // Vertical scale of the text matrix is the rendered font size; fall back to horizontal.
    const fontSize = Math.hypot(c, d) || Math.hypot(a, b);
    return { text: item.str, x, y, width: item.width, fontSize };
  });
}

/** Maps pdf.js loading errors to user-facing ones. */
export function mapPdfJsError(error: unknown, name: string): DocError {
  const kind = typeof error === "object" && error !== null && "name" in error ? String((error as { name: unknown }).name) : "";
  if (kind === "PasswordException") {
    return new DocError(
      "encrypted",
      `"${name}" is password-protected. Remove the protection in a PDF reader you trust, then try again.`,
      name,
    );
  }
  return new DocError("not-pdf", `"${name}" is damaged or is not a valid PDF file.`, name);
}

export type ExtractOptions = { documentParams?: Record<string, unknown>; signal?: AbortSignal; onProgress?: (p: { current: number; total: number }) => void };

/** Positioned text fragments for every page, plus the first page's size in points. */
export async function extractFragments(pdfjs: PdfJsLike, bytes: Uint8Array, name: string, options: ExtractOptions = {}): Promise<{ pages: TextFragment[][]; pageSize: { width: number; height: number } }> {
  // pdf.js transfers (detaches) the buffer it is given, so pass a copy.
  const task = pdfjs.getDocument({ data: bytes.slice(), ...options.documentParams });
  let doc: PdfDocumentLike;
  try {
    doc = await task.promise;
  } catch (error) {
    await task.destroy().catch(() => undefined);
    throw mapPdfJsError(error, name);
  }
  try {
    const pages: TextFragment[][] = [];
    let pageSize = { width: 595.28, height: 841.89 };
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
      throwIfCancelled(options.signal);
      options.onProgress?.({ current: pageNumber, total: doc.numPages });
      const page = await doc.getPage(pageNumber);
      if (pageNumber === 1) {
        const [x0, y0, x1, y1] = page.view;
        pageSize = { width: Math.abs(x1 - x0), height: Math.abs(y1 - y0) };
      }
      const content = await page.getTextContent();
      pages.push(toFragments(content.items));
    }
    return { pages, pageSize };
  } finally {
    await task.destroy().catch(() => undefined);
  }
}

export async function extractText(pdfjs: PdfJsLike, bytes: Uint8Array, name: string, options: ExtractOptions = {}): Promise<ExtractedText> {
  const { pages: fragments, pageSize } = await extractFragments(pdfjs, bytes, name, options);
  const pages = fragments.map(layoutPage);
  return { pages, pageSize, characterCount: countCharacters(pages) };
}

/**
 * PDF -> DOCX with basic layout. Refuses (rather than producing an empty document) when the PDF
 * has no selectable text, which usually means it is a scan that needs OCR first.
 */
export async function pdfToDocx(
  pdfjs: PdfJsLike,
  bytes: Uint8Array,
  name: string,
  options: Parameters<typeof extractText>[3] = {},
): Promise<{ bytes: Uint8Array; pageCount: number; characterCount: number }> {
  const extracted = await extractText(pdfjs, bytes, name, options);
  const pageCount = extracted.pages.length;
  if (pageCount === 0) {
    throw new DocError("empty", `"${name}" does not contain any pages.`, name);
  }
  if (extracted.characterCount < MIN_CHARACTERS_PER_PAGE * pageCount) {
    throw new DocError(
      "no-text",
      `"${name}" has little or no selectable text — it is probably a scanned image. Run "OCR / searchable PDF" on it first, then convert the result to Word.`,
      name,
    );
  }
  throwIfCancelled(options.signal);
  const title = name.replace(/\.pdf$/i, "");
  return { bytes: buildDocx(extracted.pages, extracted.pageSize, title), pageCount, characterCount: extracted.characterCount };
}
