// High-level document operations shared by the tool screens and the batch queue.
import { extractText, pdfToDocx } from "../lib/pdfToDocx";
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

export function wordToPdf(bytes: Uint8Array, extension: string, options: Options<never> = {}) {
  return runNative("convert_word_to_pdf", bytes, { "x-extension": extension }, { signal: options.signal });
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

export function ocrImageFiles(images: { name: string; bytes: Uint8Array }[], languages: string[], options: Options<OcrProgress> = {}) {
  return ocrImages(images, ocrDeps(languages), options);
}

/** Counts selectable characters, to report honestly how much text OCR produced. */
export async function countTextCharacters(bytes: Uint8Array, name: string): Promise<number> {
  return (await extractText(await pdfJsLike(), bytes, name, { documentParams: documentParams() })).characterCount;
}
