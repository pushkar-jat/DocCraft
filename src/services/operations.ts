// High-level document operations shared by the tool screens and the batch queue.
import { compareDocuments } from "../lib/compare";
import { DocError } from "../lib/errors";
import { pdfToXlsx } from "../lib/pdfToExcel";
import { paragraphsToMarkdown } from "../lib/markdown";
import { extractText, MIN_CHARACTERS_PER_PAGE, pdfToDocx } from "../lib/pdfToDocx";
import { ocrImages, ocrPdf, type OcrProgress } from "../lib/ocrPipeline";
import { runNative, type NativeProgress } from "./native";
import { documentParams, openPagesForOcr, pdfJsLike } from "./pdfjs";
import { runPdfWorker } from "./pdfWorkerClient";

export type CompressPreset = "high" | "balanced" | "small";

interface Options<P> {
  signal?: AbortSignal;
  onProgress?: (progress: P) => void;
}

export function compressPdf(bytes: Uint8Array, preset: CompressPreset, options: Options<NativeProgress> = {}) {
  return runNative("compress_pdf", bytes, { "x-preset": preset }, options);
}

export type LibreOfficeConversion = "to-pdf" | "pdf-to-pptx" | "pdf-to-pdfa";

/** Runs a LibreOffice conversion; `extension` is the input file type (e.g. "docx", "pdf"). */
export function convertDocument(bytes: Uint8Array, extension: string, conversion: LibreOfficeConversion, options: Options<never> = {}) {
  return runNative("convert_document", bytes, { "x-extension": extension, "x-conversion": conversion }, { signal: options.signal });
}

export function wordToPdf(bytes: Uint8Array, extension: string, options: Options<never> = {}) {
  return convertDocument(bytes, extension, "to-pdf", options);
}

export async function pdfToWord(bytes: Uint8Array, name: string, options: Options<{ current: number; total: number }> = {}) {
  return pdfToDocx(await pdfJsLike(), bytes, name, { documentParams: documentParams(), ...options });
}

function ocrDeps(languages: string[]) {
  return {
    openPages: openPagesForOcr,
    recognize: (image: Uint8Array, dpi: number | null, signal?: AbortSignal) =>
      runNative("ocr_image", image, { "x-languages": languages.join("+"), ...(dpi ? { "x-dpi": String(dpi) } : {}) }, { signal }),
    combine: async (pdfs: Uint8Array[], signal?: AbortSignal) => {
      const inputs = pdfs.map((pdf, index) => ({ name: `page ${index + 1}`, bytes: pdf }));
      return (await runPdfWorker({ op: "merge", inputs }, { signal })).outputs[0];
    },
  };
}

export function ocrPdfFile(bytes: Uint8Array, name: string, languages: string[], options: Options<OcrProgress> = {}) {
  return ocrPdf(bytes, name, ocrDeps(languages), options);
}

export function ocrImageFiles(images: { name: string; bytes: Uint8Array; dpi?: number }[], languages: string[], options: Options<OcrProgress> = {}) {
  return ocrImages(images, ocrDeps(languages), options);
}

export interface ProtectSettings {
  openPassword: string;
  permissionsPassword: string;
  allowPrinting: boolean;
  allowCopying: boolean;
  allowEditing: boolean;
}

export function protectPdf(bytes: Uint8Array, settings: ProtectSettings, options: Options<never> = {}) {
  const allow = [settings.allowPrinting && "print", settings.allowCopying && "copy", settings.allowEditing && "edit"].filter(Boolean).join(",") || "none";
  return runNative(
    "protect_pdf",
    bytes,
    { "x-user-password": encodeURIComponent(settings.openPassword), "x-owner-password": encodeURIComponent(settings.permissionsPassword), "x-allow": allow },
    { signal: options.signal },
  );
}

export function unlockPdf(bytes: Uint8Array, password: string, options: Options<never> = {}) {
  return runNative("unlock_pdf", bytes, { "x-password": encodeURIComponent(password) }, { signal: options.signal });
}

/**
 * Repairs structure natively (lopdf) and, if the file is too damaged for that, salvages every
 * readable page with pdf-lib. Reports which method worked.
 */
export async function repairPdf(bytes: Uint8Array, name: string, options: Options<never> = {}): Promise<{ bytes: Uint8Array; method: "rebuilt" | "salvaged"; pageCount: number }> {
  try {
    const repaired = await runNative("repair_pdf", bytes, {}, { signal: options.signal });
    const { pageCount } = await runPdfWorker({ op: "pageCount", input: { name, bytes: repaired } }, { signal: options.signal });
    return { bytes: repaired, method: "rebuilt", pageCount };
  } catch (error) {
    if (!(error instanceof DocError) || error.code !== "not-pdf") throw error;
  }
  try {
    const salvaged = await runPdfWorker({ op: "salvage", input: { name, bytes } }, { signal: options.signal });
    return { bytes: salvaged.outputs[0], method: "salvaged", pageCount: salvaged.pageCount };
  } catch (error) {
    if (error instanceof DocError && error.code === "encrypted") throw error;
    throw new DocError("not-pdf", `"${name}" is too damaged to repair: no readable pages were found.`, name);
  }
}

export async function pdfToExcel(bytes: Uint8Array, name: string, options: Options<{ current: number; total: number }> = {}) {
  return pdfToXlsx(await pdfJsLike(), bytes, name, { documentParams: documentParams(), ...options });
}

export async function comparePdfs(a: { name: string; bytes: Uint8Array }, b: { name: string; bytes: Uint8Array }, options: Options<{ current: number; total: number }> = {}) {
  return compareDocuments(await pdfJsLike(), a, b, { documentParams: documentParams(), ...options });
}

/** PDF -> Markdown (headings, paragraphs, lists). Refuses scans like PDF to Word does. */
export async function pdfToMarkdown(bytes: Uint8Array, name: string, options: Options<{ current: number; total: number }> = {}) {
  const extracted = await extractText(await pdfJsLike(), bytes, name, { documentParams: documentParams(), ...options });
  if (extracted.characterCount < MIN_CHARACTERS_PER_PAGE * Math.max(1, extracted.pages.length)) {
    throw new DocError(
      "no-text",
      `"${name}" has little or no selectable text — it is probably a scanned image. Run "OCR / searchable PDF" on it first, then convert the result.`,
      name,
    );
  }
  return { markdown: paragraphsToMarkdown(extracted.pages), pageCount: extracted.pages.length, characterCount: extracted.characterCount };
}

/** Counts selectable characters, to report honestly how much text OCR produced. */
export async function countTextCharacters(bytes: Uint8Array, name: string): Promise<number> {
  return (await extractText(await pdfJsLike(), bytes, name, { documentParams: documentParams() })).characterCount;
}
