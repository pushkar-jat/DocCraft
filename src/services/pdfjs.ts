import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { DocError } from "../lib/errors";
import { normalizeRotation } from "../lib/pageGeometry";
import { mapPdfJsError, type PdfJsLike } from "../lib/pdfToDocx";

type PdfJsModule = typeof import("pdfjs-dist");

let modulePromise: Promise<PdfJsModule> | null = null;

/** Loads pdf.js on first use (it is large) and points it at the bundled worker. */
export function loadPdfJs(): Promise<PdfJsModule> {
  modulePromise ??= import("pdfjs-dist").then((pdfjs) => {
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
    return pdfjs;
  });
  return modulePromise;
}

const local = (path: string) => new URL(path, window.location.href).href;

/** Every resource pdf.js may need is served from the app itself (copied by scripts/copy-pdfjs-assets.mjs). */
export function documentParams(): Record<string, unknown> {
  return {
    cMapUrl: local("/pdfjs/cmaps/"),
    cMapPacked: true,
    standardFontDataUrl: local("/pdfjs/standard_fonts/"),
    wasmUrl: local("/pdfjs/wasm/"),
    iccUrl: local("/pdfjs/iccs/"),
    useSystemFonts: true,
    enableXfa: false,
    verbosity: 0,
  };
}

export async function pdfJsLike(): Promise<PdfJsLike> {
  return (await loadPdfJs()) as unknown as PdfJsLike;
}

/** Largest page image we render (pixels), to bound memory on huge pages. */
const MAX_RENDER_PIXELS = 36_000_000;

export type ImageFormat = "jpeg" | "png";

function canvasToBytes(canvas: HTMLCanvasElement, format: ImageFormat, quality: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? blob.arrayBuffer().then((buffer) => resolve(new Uint8Array(buffer)), reject) : reject(new Error("toBlob failed"))),
      format === "png" ? "image/png" : "image/jpeg",
      quality,
    );
  });
}

export interface RenderOptions {
  dpi: number;
  format: ImageFormat;
  /** JPEG quality 0..1 */
  quality?: number;
  /** Draws on top of the rendered page; receives the canvas scale (pixels per PDF point). */
  overlay?: (context: CanvasRenderingContext2D, scale: number) => void;
}

/** Opens a PDF for local rendering of page images and thumbnails. Pages are 1-based. */
export async function openPdfRenderer(bytes: Uint8Array, name: string) {
  const pdfjs = await loadPdfJs();
  const task = pdfjs.getDocument({ data: bytes.slice(), ...documentParams() });
  let doc: Awaited<typeof task.promise>;
  try {
    doc = await task.promise;
  } catch (error) {
    await task.destroy().catch(() => undefined);
    throw mapPdfJsError(error, name);
  }

  async function draw<T>(pageNumber: number, scale: number, use: (canvas: HTMLCanvasElement, context: CanvasRenderingContext2D, scale: number) => Promise<T>): Promise<T> {
    const page = await doc.getPage(pageNumber);
    const base = page.getViewport({ scale: 1 });
    const pixels = base.width * base.height * scale * scale;
    const finalScale = pixels > MAX_RENDER_PIXELS ? scale * Math.sqrt(MAX_RENDER_PIXELS / pixels) : scale;
    const viewport = page.getViewport({ scale: finalScale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    try {
      const context = canvas.getContext("2d");
      if (!context) throw new DocError("internal", "This system could not create a drawing surface.");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas, canvasContext: context, viewport }).promise;
      return await use(canvas, context, finalScale);
    } catch (error) {
      if (error instanceof DocError) throw error;
      throw new DocError("unsupported", `Page ${pageNumber} of "${name}" could not be rendered.`, name);
    } finally {
      page.cleanup();
      canvas.width = 0;
      canvas.height = 0;
    }
  }

  return {
    pageCount: doc.numPages,
    /** Page size in points as displayed (after /Rotate). */
    async pageSize(pageNumber: number) {
      const viewport = (await doc.getPage(pageNumber)).getViewport({ scale: 1 });
      return { width: viewport.width, height: viewport.height };
    },
    /** Renders a page image at (up to) `dpi`; returns the DPI actually used. */
    render(pageNumber: number, options: RenderOptions) {
      return draw(pageNumber, options.dpi / 72, async (canvas, context, scale) => {
        options.overlay?.(context, scale);
        const image = await canvasToBytes(canvas, options.format, options.quality ?? 0.9);
        return { image, dpi: Math.round(scale * 72), width: canvas.width, height: canvas.height };
      });
    },
    /** Text items with user-space matrices, plus the scale-1 viewport transform (for search). */
    async textItems(pageNumber: number) {
      const page = await doc.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const items = content.items.flatMap((item) => ("str" in item ? [{ str: item.str, transform: item.transform as number[], width: item.width }] : []));
      return { items, viewport: { transform: viewport.transform as number[], width: viewport.width, height: viewport.height } };
    },
    /** Page rotation and crop box (user space), for mapping on-screen boxes into the PDF. */
    async geometry(pageNumber: number) {
      const page = await doc.getPage(pageNumber);
      const [x0, y0, x1, y1] = page.view;
      return {
        rotation: normalizeRotation(page.rotate),
        crop: { x: Math.min(x0, x1), y: Math.min(y0, y1), width: Math.abs(x1 - x0), height: Math.abs(y1 - y0) },
      };
    },
    /** Small preview as a data: URL (allowed by the CSP), `maxWidth` pixels wide. */
    async thumbnail(pageNumber: number, maxWidth: number) {
      const viewport = (await doc.getPage(pageNumber)).getViewport({ scale: 1 });
      return draw(pageNumber, maxWidth / viewport.width, async (canvas) => canvas.toDataURL("image/jpeg", 0.75));
    },
    close: () => task.destroy(),
  };
}

/** Opens a PDF for OCR: renders pages locally to JPEG at up to `dpi`. */
export async function openPagesForOcr(bytes: Uint8Array, name: string, dpi: number) {
  const renderer = await openPdfRenderer(bytes, name);
  return {
    pageCount: renderer.pageCount,
    render: async (pageNumber: number) => {
      const { image, dpi: used } = await renderer.render(pageNumber, { dpi, format: "jpeg", quality: 0.9 });
      return { image, dpi: used };
    },
    close: renderer.close,
  };
}
