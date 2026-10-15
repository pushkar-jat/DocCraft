import { concatTransformationMatrix, PDFDocument, popGraphicsState, pushGraphicsState, type PDFImage } from "pdf-lib";
import { DocError, throwIfCancelled } from "./errors";
import { yieldToEventLoop } from "./merge";

export type ImageKind = "jpeg" | "png";
export type PageSizeMode = "image" | "a4" | "letter";
export type Matrix = [number, number, number, number, number, number];

export interface ImageInput {
  name: string;
  bytes: Uint8Array;
}

export interface ImagesToPdfOptions {
  pageSize: PageSizeMode;
  signal?: AbortSignal;
  onProgress?: (progress: { current: number; total: number }) => void;
}

const PAGE_SIZES = { a4: [595.28, 841.89], letter: [612, 792] } as const;
const MARGIN = 36; // 0.5 inch
/** CSS/screen convention: 96 pixels per inch -> 0.75 PDF points per pixel. */
const POINTS_PER_PIXEL = 0.75;
/** PDF viewers commonly cap page sides at 200 inches. */
const MAX_PAGE_SIDE = 14400;

export function detectImageKind(bytes: Uint8Array): ImageKind | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length >= 8 && png.every((value, index) => bytes[index] === value)) return "png";
  return null;
}

/** Reads the EXIF orientation (1-8) from a JPEG; 1 when absent or unreadable. */
export function readJpegOrientation(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return 1;
    const marker = bytes[offset + 1];
    if (marker === 0xda || marker === 0xd9) return 1; // start of scan / end of image
    const length = view.getUint16(offset + 2);
    if (length < 2) return 1;
    if (marker === 0xe1 && offset + 10 <= bytes.length && view.getUint32(offset + 4) === 0x45786966 /* "Exif" */) {
      return orientationFromTiff(view, offset + 10, Math.min(bytes.length, offset + 2 + length));
    }
    offset += 2 + length;
  }
  return 1;
}

function orientationFromTiff(view: DataView, tiff: number, end: number): number {
  if (tiff + 8 > end) return 1;
  const little = view.getUint16(tiff) === 0x4949;
  const u16 = (at: number) => view.getUint16(at, little);
  const u32 = (at: number) => view.getUint32(at, little);
  const ifd = tiff + u32(tiff + 4);
  if (ifd + 2 > end) return 1;
  const entries = u16(ifd);
  for (let i = 0; i < entries; i++) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > end) return 1;
    if (u16(entry) === 0x0112) {
      const value = u16(entry + 8);
      return value >= 1 && value <= 8 ? value : 1;
    }
  }
  return 1;
}

/** Display size of a stored `width` x `height` image after applying EXIF `orientation`. */
export function orientedSize(orientation: number, width: number, height: number): [number, number] {
  return orientation >= 5 ? [height, width] : [width, height];
}

/**
 * PDF matrix mapping the stored image box [0,w]x[0,h] to its upright display box, for each EXIF
 * orientation (1 normal, 2 mirrored, 3 rotated 180°, 4 flipped, 5 transposed, 6 rotated 90° CW,
 * 7 transverse, 8 rotated 90° CCW).
 */
export function orientationMatrix(orientation: number, w: number, h: number): Matrix {
  switch (orientation) {
    case 2: return [-1, 0, 0, 1, w, 0];
    case 3: return [-1, 0, 0, -1, w, h];
    case 4: return [1, 0, 0, -1, 0, h];
    case 5: return [0, -1, -1, 0, h, w];
    case 6: return [0, -1, 1, 0, 0, w];
    case 7: return [0, 1, 1, 0, 0, 0];
    case 8: return [0, 1, -1, 0, h, 0];
    default: return [1, 0, 0, 1, 0, 0];
  }
}

/** Page size and image placement (x, y, scale) for an upright image of `width` x `height` px. */
export function layoutImage(mode: PageSizeMode, width: number, height: number) {
  if (mode === "image") {
    const scale = Math.min(POINTS_PER_PIXEL, MAX_PAGE_SIDE / Math.max(width, height));
    return { pageWidth: width * scale, pageHeight: height * scale, x: 0, y: 0, scale };
  }
  const [short, long] = PAGE_SIZES[mode];
  const landscape = width > height;
  const pageWidth = landscape ? long : short;
  const pageHeight = landscape ? short : long;
  // Shrink to fit inside the margins, but never enlarge beyond natural (96 dpi) size.
  const scale = Math.min(POINTS_PER_PIXEL, (pageWidth - 2 * MARGIN) / width, (pageHeight - 2 * MARGIN) / height);
  return {
    pageWidth,
    pageHeight,
    x: (pageWidth - width * scale) / 2,
    y: (pageHeight - height * scale) / 2,
    scale,
  };
}

async function embed(doc: PDFDocument, image: ImageInput): Promise<{ embedded: PDFImage; orientation: number }> {
  const kind = detectImageKind(image.bytes);
  if (kind === null) {
    throw new DocError("invalid-image", `"${image.name}" is not a valid JPEG or PNG image.`, image.name);
  }
  try {
    if (kind === "jpeg") {
      return { embedded: await doc.embedJpg(image.bytes), orientation: readJpegOrientation(image.bytes) };
    }
    return { embedded: await doc.embedPng(image.bytes), orientation: 1 };
  } catch {
    throw new DocError("invalid-image", `"${image.name}" is damaged or uses an image format DocCraft cannot read.`, image.name);
  }
}

/** One page per image, in the given order. JPEG data is embedded as-is (no re-encoding). */
export async function imagesToPdf(images: readonly ImageInput[], options: ImagesToPdfOptions): Promise<{ bytes: Uint8Array; pageCount: number }> {
  if (images.length === 0) {
    throw new DocError("not-enough-files", "Add at least one image.");
  }
  const doc = await PDFDocument.create();
  doc.setProducer("DocCraft");
  doc.setCreator("DocCraft");

  for (const [index, image] of images.entries()) {
    options.onProgress?.({ current: index + 1, total: images.length });
    await yieldToEventLoop();
    throwIfCancelled(options.signal);

    const { embedded, orientation } = await embed(doc, image);
    const [displayWidth, displayHeight] = orientedSize(orientation, embedded.width, embedded.height);
    const layout = layoutImage(options.pageSize, displayWidth, displayHeight);
    const page = doc.addPage([layout.pageWidth, layout.pageHeight]);
    const [a, b, c, d, e, f] = orientationMatrix(orientation, embedded.width, embedded.height);
    const s = layout.scale;
    page.pushOperators(pushGraphicsState(), concatTransformationMatrix(s * a, s * b, s * c, s * d, s * e + layout.x, s * f + layout.y));
    page.drawImage(embedded, { x: 0, y: 0, width: embedded.width, height: embedded.height });
    page.pushOperators(popGraphicsState());
  }

  throwIfCancelled(options.signal);
  return { bytes: await doc.save(), pageCount: doc.getPageCount() };
}
