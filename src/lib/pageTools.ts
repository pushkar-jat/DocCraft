import { degrees, PDFDict, PDFDocument, PDFName, rgb, StandardFonts, type PDFFont, type PDFImage, type PDFPage, type PDFRef } from "pdf-lib";
import { DocError, throwIfCancelled } from "./errors";
import { detectImageKind } from "./images";
import { loadPdf, yieldToEventLoop, type PdfInput } from "./merge";
import { rangesToIndices, type PageRange } from "./pageRanges";
import {
  anchorPoint,
  displayMarginsToUser,
  displaySize,
  displayToUser,
  normalizeRotation,
  rotatedStartForCenter,
  type Anchor,
  type Margins,
  type Rotation,
} from "./pageGeometry";

export interface ToolOptions {
  signal?: AbortSignal;
  onProgress?: (progress: { current: number; total: number }) => void;
}

/** null = every page. */
export type PageSelection = PageRange[] | null;

function selectedIndices(selection: PageSelection, pageCount: number): Set<number> {
  const indices = selection === null ? [...Array(pageCount).keys()] : rangesToIndices(selection);
  if (indices.some((index) => index < 0 || index >= pageCount)) {
    throw new DocError("invalid-range", "The selected pages do not exist in this PDF.");
  }
  return new Set(indices);
}

async function finish(doc: PDFDocument, options: ToolOptions): Promise<Uint8Array> {
  throwIfCancelled(options.signal);
  doc.setProducer("DocCraft");
  return doc.save();
}

async function forEachPage(doc: PDFDocument, selection: Set<number>, options: ToolOptions, action: (page: PDFPage, index: number) => void | Promise<void>) {
  const pages = doc.getPages();
  let done = 0;
  for (const [index, page] of pages.entries()) {
    if (!selection.has(index)) continue;
    if (done % 25 === 0) {
      options.onProgress?.({ current: done + 1, total: selection.size });
      await yieldToEventLoop();
      throwIfCancelled(options.signal);
    }
    await action(page, index);
    done++;
  }
}

function pageRotation(page: PDFPage): Rotation {
  return normalizeRotation(page.getRotation().angle);
}

/** Copies the pages at `indices` (any order, duplicates allowed) into a new document. */
async function copyInto(source: PDFDocument, indices: number[], name: string): Promise<PDFDocument> {
  const output = await PDFDocument.create();
  output.setCreator("DocCraft");
  try {
    const pages = await output.copyPages(source, indices);
    pages.forEach((page) => output.addPage(page));
  } catch {
    throw new DocError("unsupported", `"${name}" uses a PDF structure DocCraft cannot rearrange yet.`, name);
  }
  return output;
}

// ---------------------------------------------------------------- salvage (repair fallback)

/**
 * Copies every readable page into a fresh document. pdf-lib parses objects sequentially instead
 * of trusting the cross-reference table, so this recovers many files with broken structure.
 */
export async function salvagePdf(input: PdfInput, options: ToolOptions = {}): Promise<{ bytes: Uint8Array; pageCount: number }> {
  const nothing = () => new DocError("empty", `No pages could be recovered from "${input.name}".`, input.name);
  const start = findHeader(input.bytes);
  let source: PDFDocument;
  try {
    source = await PDFDocument.load(start > 0 ? input.bytes.subarray(start) : input.bytes, { ignoreEncryption: true, updateMetadata: false, throwOnInvalidObject: false });
  } catch {
    throw nothing();
  }
  if (source.isEncrypted) {
    throw new DocError("encrypted", `"${input.name}" is password-protected. Unlock it first, then repair it.`, input.name);
  }
  throwIfCancelled(options.signal);

  let pageCount = 0;
  try {
    pageCount = source.getPageCount();
  } catch {
    // The catalog or page tree is missing: rebuild them from the page objects that survived.
    source = await rebuildPageTree(source).catch(() => {
      throw nothing();
    });
    pageCount = source.getPageCount();
  }
  if (pageCount === 0) throw nothing();
  const output = await copyInto(source, source.getPageIndices(), input.name);
  return { bytes: await finish(output, options), pageCount };
}

async function rebuildPageTree(doc: PDFDocument): Promise<PDFDocument> {
  const context = doc.context;
  const pageRefs: PDFRef[] = [];
  for (const [ref, object] of context.enumerateIndirectObjects()) {
    if (object instanceof PDFDict && object.get(PDFName.of("Type")) === PDFName.of("Page")) pageRefs.push(ref);
  }
  if (pageRefs.length === 0) throw new Error("no pages");
  const pagesRef = context.nextRef();
  for (const ref of pageRefs) {
    const page = context.lookup(ref, PDFDict);
    page.set(PDFName.of("Parent"), pagesRef);
    // MediaBox may have been inherited from a lost parent; fall back to US Letter.
    if (!page.has(PDFName.of("MediaBox"))) page.set(PDFName.of("MediaBox"), context.obj([0, 0, 612, 792]));
  }
  context.assign(pagesRef, context.obj({ Type: "Pages", Kids: pageRefs, Count: pageRefs.length }));
  context.trailerInfo.Root = context.register(context.obj({ Type: "Catalog", Pages: pagesRef }));
  return PDFDocument.load(await doc.save({ useObjectStreams: false }), { updateMetadata: false });
}

function findHeader(bytes: Uint8Array): number {
  const limit = Math.min(bytes.length - 5, 64 * 1024);
  for (let i = 0; i <= limit; i++) {
    if (bytes[i] === 0x25 && bytes[i + 1] === 0x50 && bytes[i + 2] === 0x44 && bytes[i + 3] === 0x46 && bytes[i + 4] === 0x2d) return i;
  }
  return 0;
}

// ---------------------------------------------------------------- remove / rotate / organize

export async function removePages(input: PdfInput, remove: PageRange[], options: ToolOptions = {}): Promise<Uint8Array> {
  const source = await loadPdf(input);
  const removed = selectedIndices(remove, source.getPageCount());
  const keep = source.getPageIndices().filter((index) => !removed.has(index));
  if (keep.length === 0) {
    throw new DocError("invalid-range", "You cannot remove every page. Keep at least one page.");
  }
  throwIfCancelled(options.signal);
  return finish(await copyInto(source, keep, input.name), options);
}

export async function rotatePages(input: PdfInput, selection: PageSelection, by: 90 | 180 | 270, options: ToolOptions = {}): Promise<Uint8Array> {
  const doc = await loadPdf(input);
  await forEachPage(doc, selectedIndices(selection, doc.getPageCount()), options, (page) => {
    page.setRotation(degrees(normalizeRotation(page.getRotation().angle + by)));
  });
  return finish(doc, options);
}

/** One entry per output page: a source page (0-based) or a blank page, plus extra rotation. */
export type OrganizeItem = { source: number; rotate: Rotation } | { blank: true };

export async function organizePages(input: PdfInput, items: OrganizeItem[], options: ToolOptions = {}): Promise<Uint8Array> {
  if (items.length === 0) throw new DocError("invalid-range", "The document would have no pages. Keep at least one page.");
  const source = await loadPdf(input);
  const count = source.getPageCount();
  const sourceIndices = items.flatMap((item) => ("source" in item ? [item.source] : []));
  if (sourceIndices.some((index) => index < 0 || index >= count)) throw new DocError("invalid-range", "A page in the new order does not exist.");
  const output = await PDFDocument.create();
  output.setCreator("DocCraft");
  let copied: PDFPage[];
  try {
    copied = await output.copyPages(source, sourceIndices);
  } catch {
    throw new DocError("unsupported", `"${input.name}" uses a PDF structure DocCraft cannot rearrange yet.`, input.name);
  }
  let next = 0;
  let lastSize: [number, number] = [595.28, 841.89];
  for (const item of items) {
    throwIfCancelled(options.signal);
    if ("blank" in item) {
      output.addPage(lastSize);
      continue;
    }
    const page = output.addPage(copied[next++]);
    page.setRotation(degrees(normalizeRotation(page.getRotation().angle + item.rotate)));
    const { width, height } = page.getSize();
    lastSize = [width, height];
  }
  return finish(output, options);
}

// ---------------------------------------------------------------- page numbers

export type NumberFormat = "n" | "page-n" | "n-of-total" | "page-n-of-total";

export interface PageNumberOptions {
  selection: PageSelection;
  anchor: Anchor;
  format: NumberFormat;
  /** Number shown on the first numbered page. */
  start: number;
  fontSize: number;
  /** Distance from the page edge in points. */
  margin: number;
}

export function formatPageNumber(format: NumberFormat, n: number, total: number): string {
  switch (format) {
    case "n":
      return String(n);
    case "page-n":
      return `Page ${n}`;
    case "n-of-total":
      return `${n} / ${total}`;
    case "page-n-of-total":
      return `Page ${n} of ${total}`;
  }
}

/** Draws one line of text at a display-space position, correctly oriented on rotated pages. */
function drawDisplayText(page: PDFPage, text: string, font: PDFFont, size: number, dx: number, dy: number, opacity = 1) {
  const rotation = pageRotation(page);
  const { width, height } = page.getSize();
  const { x, y, angle } = displayToUser(rotation, width, height, dx, dy);
  page.drawText(text, { x, y, size, font, color: rgb(0.1, 0.1, 0.1), rotate: degrees(angle), opacity });
}

export async function addPageNumbers(input: PdfInput, settings: PageNumberOptions, options: ToolOptions = {}): Promise<Uint8Array> {
  const doc = await loadPdf(input);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const selected = selectedIndices(settings.selection, doc.getPageCount());
  const total = settings.start + selected.size - 1;
  let n = settings.start;
  await forEachPage(doc, selected, options, (page) => {
    const text = formatPageNumber(settings.format, n++, total);
    const { width, height } = displaySize(pageRotation(page), page.getWidth(), page.getHeight());
    const textWidth = font.widthOfTextAtSize(text, settings.fontSize);
    const textHeight = font.heightAtSize(settings.fontSize, { descender: false });
    const { dx, dy } = anchorPoint(settings.anchor, width, height, textWidth, textHeight, settings.margin);
    drawDisplayText(page, text, font, settings.fontSize, dx, dy);
  });
  return finish(doc, options);
}

// ---------------------------------------------------------------- watermark

export type WatermarkContent = { kind: "text"; text: string; fontSize: number; color: [number, number, number] } | { kind: "image"; bytes: Uint8Array; name: string; scale: number };

export interface WatermarkOptions {
  selection: PageSelection;
  content: WatermarkContent;
  /** 0..1 */
  opacity: number;
  /** Degrees counter-clockwise, as seen on screen. */
  angle: number;
  layout: "center" | "tile";
}

async function embedWatermarkImage(doc: PDFDocument, content: Extract<WatermarkContent, { kind: "image" }>): Promise<PDFImage> {
  const kind = detectImageKind(content.bytes);
  try {
    if (kind === "jpeg") return await doc.embedJpg(content.bytes);
    if (kind === "png") return await doc.embedPng(content.bytes);
  } catch {
    // fall through
  }
  throw new DocError("invalid-image", `"${content.name}" is not a valid JPEG or PNG image.`, content.name);
}

export async function addWatermark(input: PdfInput, settings: WatermarkOptions, options: ToolOptions = {}): Promise<Uint8Array> {
  const doc = await loadPdf(input);
  const content = settings.content;
  if (content.kind === "text" && content.text.trim() === "") throw new DocError("invalid-range", "Enter the watermark text.");
  const font = content.kind === "text" ? await doc.embedFont(StandardFonts.HelveticaBold) : null;
  const image = content.kind === "image" ? await embedWatermarkImage(doc, content) : null;
  const opacity = Math.min(Math.max(settings.opacity, 0.05), 1);

  await forEachPage(doc, selectedIndices(settings.selection, doc.getPageCount()), options, (page) => {
    const rotation = pageRotation(page);
    const { width: pw, height: ph } = page.getSize();
    const display = displaySize(rotation, pw, ph);

    let boxWidth: number;
    let boxHeight: number;
    if (font && content.kind === "text") {
      boxWidth = font.widthOfTextAtSize(content.text, content.fontSize);
      boxHeight = font.heightAtSize(content.fontSize, { descender: false });
    } else {
      const scale = Math.min(Math.max(content.kind === "image" ? content.scale : 0.5, 0.05), 1);
      const fit = Math.min((display.width * scale) / image!.width, (display.height * scale) / image!.height);
      boxWidth = image!.width * fit;
      boxHeight = image!.height * fit;
    }

    const centres: [number, number][] =
      settings.layout === "center"
        ? [[display.width / 2, display.height / 2]]
        : tileCentres(display.width, display.height, Math.max(boxWidth, boxHeight) * 1.6);

    for (const [cx, cy] of centres) {
      const userCentre = displayToUser(rotation, pw, ph, cx, cy);
      const angle = userCentre.angle + settings.angle;
      const start = rotatedStartForCenter(userCentre.x, userCentre.y, boxWidth, boxHeight, angle);
      if (font && content.kind === "text") {
        const [r, g, b] = content.color;
        page.drawText(content.text, { x: start.x, y: start.y, size: content.fontSize, font, color: rgb(r, g, b), opacity, rotate: degrees(angle) });
      } else if (image) {
        page.drawImage(image, { x: start.x, y: start.y, width: boxWidth, height: boxHeight, opacity, rotate: degrees(angle) });
      }
    }
  });
  return finish(doc, options);
}

export function tileCentres(width: number, height: number, step: number): [number, number][] {
  const spacing = Math.max(step, 60);
  const centres: [number, number][] = [];
  for (let y = spacing / 2; y < height; y += spacing) {
    for (let x = spacing / 2; x < width; x += spacing) centres.push([x, y]);
  }
  return centres;
}

// ---------------------------------------------------------------- crop

export async function cropPages(input: PdfInput, selection: PageSelection, margins: Margins, options: ToolOptions = {}): Promise<Uint8Array> {
  if (Object.values(margins).some((value) => value < 0)) throw new DocError("invalid-range", "Margins cannot be negative.");
  const doc = await loadPdf(input);
  await forEachPage(doc, selectedIndices(selection, doc.getPageCount()), options, (page, index) => {
    const box = page.getCropBox();
    const user = displayMarginsToUser(pageRotation(page), margins);
    const width = box.width - user.left - user.right;
    const height = box.height - user.top - user.bottom;
    if (width < 36 || height < 36) {
      throw new DocError("invalid-range", `The margins are larger than page ${index + 1}. Use smaller margins.`);
    }
    page.setCropBox(box.x + user.left, box.y + user.bottom, width, height);
  });
  return finish(doc, options);
}
