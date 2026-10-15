import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { DocError } from "../lib/errors";
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

/** Largest page image we render for OCR (pixels), to bound memory on huge pages. */
const MAX_RENDER_PIXELS = 36_000_000;

function canvasToJpeg(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? blob.arrayBuffer().then((buffer) => resolve(new Uint8Array(buffer)), reject) : reject(new Error("toBlob failed"))),
      "image/jpeg",
      0.9,
    );
  });
}

/** Opens a PDF for OCR: renders pages locally to JPEG at up to `dpi`. */
export async function openPagesForOcr(bytes: Uint8Array, name: string, dpi: number) {
  const pdfjs = await loadPdfJs();
  const task = pdfjs.getDocument({ data: bytes.slice(), ...documentParams() });
  let doc: Awaited<typeof task.promise>;
  try {
    doc = await task.promise;
  } catch (error) {
    await task.destroy().catch(() => undefined);
    throw mapPdfJsError(error, name);
  }
  return {
    pageCount: doc.numPages,
    async render(pageNumber: number) {
      const page = await doc.getPage(pageNumber);
      const base = page.getViewport({ scale: 1 });
      let scale = dpi / 72;
      const pixels = base.width * base.height * scale * scale;
      if (pixels > MAX_RENDER_PIXELS) scale *= Math.sqrt(MAX_RENDER_PIXELS / pixels);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      try {
        const context = canvas.getContext("2d");
        if (!context) throw new DocError("internal", "This system could not create a drawing surface for OCR.");
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvas, canvasContext: context, viewport }).promise;
        const image = await canvasToJpeg(canvas);
        return { image, dpi: Math.round(scale * 72) };
      } catch (error) {
        if (error instanceof DocError) throw error;
        throw new DocError("unsupported", `Page ${pageNumber} of "${name}" could not be rendered for OCR.`, name);
      } finally {
        page.cleanup();
        canvas.width = 0;
        canvas.height = 0;
      }
    },
    close: () => task.destroy(),
  };
}
