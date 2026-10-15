import { PDFDocument, PDFName } from "pdf-lib";

/**
 * Creates a PDF whose pages have distinctive widths so tests can check page order:
 * page `i` of document `docId` is `docId * 100 + i` points wide.
 */
export async function makePdf(docId: number, pageCount: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pageCount; i++) {
    doc.addPage([docId * 100 + i, 200]);
  }
  return doc.save();
}

/** Width tags of every page in a PDF, in order. */
export async function pageWidths(bytes: Uint8Array): Promise<number[]> {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((page) => Math.round(page.getWidth()));
}

/** A PDF with an /Encrypt entry in its trailer, which is how readers detect encryption. */
export async function makeEncryptedPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([300, 300]);
  const encrypt = doc.context.obj({ Filter: PDFName.of("Standard"), V: 1, R: 2, P: -4 });
  doc.context.trailerInfo.Encrypt = doc.context.register(encrypt);
  return doc.save({ useObjectStreams: false });
}

/** pdf-lib inserts a blank page on save by default, so opt out to get a truly page-less PDF. */
export async function makeEmptyPdf(): Promise<Uint8Array> {
  return (await PDFDocument.create()).save({ addDefaultPage: false });
}

export const textBytes = (text: string) => new TextEncoder().encode(text);
