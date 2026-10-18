// Services for the page editor tools (Edit PDF, Redact, Sign).
import { throwIfCancelled } from "../lib/errors";
import type { NormalizedBox } from "../lib/pageGeometry";
import { boxToPixels, type RedactedPage } from "../lib/redact";
import { findTermBoxes } from "../lib/textSearch";
import { runNative } from "./native";
import { openPdfRenderer } from "./pdfjs";

export type PdfRenderer = Awaited<ReturnType<typeof openPdfRenderer>>;

/** Finds every occurrence of `term` on every page. Keys are 0-based page indices. */
export async function findTerm(renderer: PdfRenderer, term: string, signal?: AbortSignal): Promise<Map<number, NormalizedBox[]>> {
  const found = new Map<number, NormalizedBox[]>();
  for (let page = 1; page <= renderer.pageCount; page++) {
    throwIfCancelled(signal);
    const { items, viewport } = await renderer.textItems(page);
    const boxes = findTermBoxes(items, term, viewport.transform, viewport.width, viewport.height);
    if (boxes.length > 0) found.set(page - 1, boxes);
  }
  return found;
}

/**
 * Renders each page that has redaction boxes, with the boxes painted solid black into the image.
 * The original page content under the boxes is not kept anywhere in the result.
 */
export async function renderRedactedPages(
  renderer: PdfRenderer,
  boxesByPage: Map<number, NormalizedBox[]>,
  options: { dpi?: number; signal?: AbortSignal; onProgress?: (done: number, total: number) => void } = {},
): Promise<RedactedPage[]> {
  const pages: RedactedPage[] = [];
  const entries = [...boxesByPage.entries()].filter(([, boxes]) => boxes.length > 0).sort(([a], [b]) => a - b);
  for (const [done, [index, boxes]] of entries.entries()) {
    throwIfCancelled(options.signal);
    options.onProgress?.(done, entries.length);
    const size = await renderer.pageSize(index + 1);
    const { image } = await renderer.render(index + 1, {
      dpi: options.dpi ?? 200,
      format: "jpeg",
      quality: 0.92,
      overlay: (context) => {
        context.fillStyle = "#000000";
        for (const box of boxes) {
          const { x, y, width, height } = boxToPixels(box, context.canvas.width, context.canvas.height);
          context.fillRect(Math.floor(x), Math.floor(y), Math.ceil(width) + 1, Math.ceil(height) + 1);
        }
      },
    });
    pages.push({ index, image, width: size.width, height: size.height });
  }
  return pages;
}

export interface CertificateSignature {
  p12: Uint8Array;
  password: string;
  /** 0-based page. */
  page: number;
  /** User-space rectangle [x1, y1, x2, y2], or null for an invisible signature. */
  rect: [number, number, number, number] | null;
  reason: string;
  location: string;
}

/** Signs with a PKCS#12 certificate (PAdES). The PDF and certificate travel in one buffer. */
export function signWithCertificate(pdf: Uint8Array, signature: CertificateSignature, signal?: AbortSignal): Promise<Uint8Array> {
  const body = new Uint8Array(4 + pdf.length + signature.p12.length);
  new DataView(body.buffer).setUint32(0, pdf.length);
  body.set(pdf, 4);
  body.set(signature.p12, 4 + pdf.length);
  return runNative(
    "sign_pdf",
    body,
    {
      "x-p12-password": encodeURIComponent(signature.password),
      "x-page": String(signature.page),
      "x-rect": signature.rect ? signature.rect.map((value) => value.toFixed(2)).join(",") : "",
      "x-reason": encodeURIComponent(signature.reason),
      "x-location": encodeURIComponent(signature.location),
    },
    { signal },
  );
}

/** data: URL for previewing image bytes (the CSP allows data: images but not blob: URLs). */
export function bytesToDataUrl(bytes: Uint8Array, mime: string): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${mime};base64,${btoa(binary)}`;
}
