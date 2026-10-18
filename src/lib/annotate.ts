import { BlendMode, degrees, PDFDocument, rgb, StandardFonts, type PDFFont, type PDFImage } from "pdf-lib";
import { DocError, throwIfCancelled } from "./errors";
import { detectImageKind } from "./images";
import { loadPdf, type PdfInput } from "./merge";
import { normalizedToUser, normalizeRotation, type NormalizedBox } from "./pageGeometry";

export type Color = [number, number, number];

export type OverlayItem =
  | { kind: "text"; page: number; box: NormalizedBox; text: string; fontSize: number; color: Color }
  | { kind: "image"; page: number; box: NormalizedBox; bytes: Uint8Array; name: string }
  | { kind: "rect"; page: number; box: NormalizedBox; color: Color; lineWidth: number }
  | { kind: "whiteout"; page: number; box: NormalizedBox }
  | { kind: "highlight"; page: number; box: NormalizedBox; color: Color };

/** Rotates a local offset (in the box's upright frame) into user space. */
function rotate(angle: number, ox: number, oy: number): { x: number; y: number } {
  const r = (angle * Math.PI) / 180;
  return { x: ox * Math.cos(r) - oy * Math.sin(r), y: ox * Math.sin(r) + oy * Math.cos(r) };
}

/** Greedy word wrap to `maxWidth`; explicit newlines are kept. */
export function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push("");
      continue;
    }
    let line = words[0];
    for (const word of words.slice(1)) {
      const candidate = `${line} ${word}`;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) line = candidate;
      else {
        lines.push(line);
        line = word;
      }
    }
    lines.push(line);
  }
  return lines;
}

async function embedImage(doc: PDFDocument, item: Extract<OverlayItem, { kind: "image" }>, cache: Map<Uint8Array, PDFImage>): Promise<PDFImage> {
  const cached = cache.get(item.bytes);
  if (cached) return cached;
  const kind = detectImageKind(item.bytes);
  let image: PDFImage | null = null;
  try {
    if (kind === "jpeg") image = await doc.embedJpg(item.bytes);
    if (kind === "png") image = await doc.embedPng(item.bytes);
  } catch {
    image = null;
  }
  if (!image) throw new DocError("invalid-image", `"${item.name}" is not a valid JPEG or PNG image.`, item.name);
  cache.set(item.bytes, image);
  return image;
}

/** Draws overlay items (text, images, shapes) onto the pages, upright as the user placed them. */
export async function applyOverlays(input: PdfInput, items: readonly OverlayItem[], options: { signal?: AbortSignal } = {}): Promise<Uint8Array> {
  const doc = await loadPdf(input);
  const pages = doc.getPages();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const images = new Map<Uint8Array, PDFImage>();

  for (const item of items) {
    throwIfCancelled(options.signal);
    const page = pages[item.page];
    if (!page) throw new DocError("invalid-range", "An item was placed on a page that does not exist.");
    const crop = page.getCropBox();
    const placed = normalizedToUser(normalizeRotation(page.getRotation().angle), crop, item.box);
    const { rect, origin, angle } = placed;

    switch (item.kind) {
      case "whiteout":
        page.drawRectangle({ ...rect, color: rgb(1, 1, 1), borderWidth: 0 });
        break;
      case "highlight":
        page.drawRectangle({ ...rect, color: rgb(...item.color), opacity: 0.35, borderWidth: 0, blendMode: BlendMode.Multiply });
        break;
      case "rect":
        page.drawRectangle({ ...rect, borderColor: rgb(...item.color), borderWidth: item.lineWidth });
        break;
      case "image": {
        const image = await embedImage(doc, item, images);
        const scale = Math.min(placed.width / image.width, placed.height / image.height);
        const width = image.width * scale;
        const height = image.height * scale;
        const offset = rotate(angle, (placed.width - width) / 2, (placed.height - height) / 2);
        page.drawImage(image, { x: origin.x + offset.x, y: origin.y + offset.y, width, height, rotate: degrees(angle) });
        break;
      }
      case "text": {
        const size = Math.min(Math.max(item.fontSize, 4), 200);
        let lines: string[];
        try {
          lines = wrapText(item.text, font, size, Math.max(placed.width - 4, size));
          lines.forEach((line) => font.encodeText(line));
        } catch {
          throw new DocError(
            "unsupported",
            "Some text uses characters the built-in font cannot display (for example non-Latin scripts). Use Latin characters, or add the text as an image.",
          );
        }
        lines.forEach((line, index) => {
          const baseline = placed.height - size * (0.95 + index * 1.25);
          const start = rotate(angle, 2, baseline);
          page.drawText(line, { x: origin.x + start.x, y: origin.y + start.y, size, font, color: rgb(...item.color), rotate: degrees(angle) });
        });
        break;
      }
    }
  }
  doc.setProducer("DocCraft");
  return doc.save();
}
