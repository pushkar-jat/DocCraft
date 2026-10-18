import { DocError, throwIfCancelled } from "./errors";
import { extractFragments, MIN_CHARACTERS_PER_PAGE, type ExtractOptions, type PdfJsLike } from "./pdfToDocx";
import { layoutTable } from "./tableLayout";
import { buildXlsx } from "./xlsxWriter";

/**
 * PDF -> XLSX with one worksheet per page, rebuilding rows and columns from text positions.
 * Refuses scanned PDFs (no text) rather than producing an empty workbook.
 */
export async function pdfToXlsx(pdfjs: PdfJsLike, bytes: Uint8Array, name: string, options: ExtractOptions = {}): Promise<{ bytes: Uint8Array; sheetCount: number; cellCount: number }> {
  const { pages } = await extractFragments(pdfjs, bytes, name, options);
  const characters = pages.flat().reduce((sum, fragment) => sum + fragment.text.replace(/\s/g, "").length, 0);
  if (pages.length === 0) throw new DocError("empty", `"${name}" does not contain any pages.`, name);
  if (characters < MIN_CHARACTERS_PER_PAGE * pages.length) {
    throw new DocError(
      "no-text",
      `"${name}" has little or no selectable text — it is probably a scanned image. Run "OCR PDF" on it first, then convert the result.`,
      name,
    );
  }
  throwIfCancelled(options.signal);
  const sheets = pages.map((fragments, index) => ({ name: `Page ${index + 1}`, rows: layoutTable(fragments) }));
  const cellCount = sheets.reduce((sum, sheet) => sum + sheet.rows.reduce((n, row) => n + row.filter((value) => value !== "").length, 0), 0);
  return { bytes: buildXlsx(sheets), sheetCount: sheets.length, cellCount };
}
