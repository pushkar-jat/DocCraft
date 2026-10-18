import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strFromU8, unzipSync } from "fflate";
import { PDFDocument, StandardFonts } from "pdf-lib";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it } from "vitest";
import { png } from "../test/imageFixtures";
import { DocError } from "./errors";
import type { PdfJsLike } from "./pdfToDocx";
import { pdfToXlsx } from "./pdfToExcel";
import { layoutTable, toCellValue } from "./tableLayout";
import { columnName, sheetNames } from "./xlsxWriter";

const lib = pdfjs as unknown as PdfJsLike;
const quiet = { documentParams: { verbosity: 0 } };

async function tablePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([595, 842]);
  const rows = [
    ["Item", "Qty", "Price"],
    ["Apples", "3", "1,250.50"],
    ["Pears", "12", "99%"],
    ["Order 007", "", "4.5"],
  ];
  rows.forEach((row, r) =>
    row.forEach((cell, c) => {
      if (cell) page.drawText(cell, { x: 72 + c * 150, y: 700 - r * 20, size: 11, font });
    }),
  );
  return doc.save();
}

function sheetXml(xlsx: Uint8Array, index = 1): string {
  return strFromU8(unzipSync(xlsx)[`xl/worksheets/sheet${index}.xml`]);
}

describe("table helpers", () => {
  it("parses numbers but keeps IDs with leading zeros as text", () => {
    expect(toCellValue("1,250.50")).toBe(1250.5);
    expect(toCellValue("-12")).toBe(-12);
    expect(toCellValue("45%")).toBe(0.45);
    expect(toCellValue("007")).toBe("007");
    expect(toCellValue("12 apples")).toBe("12 apples");
  });

  it("names columns and sheets like Excel", () => {
    expect([0, 25, 26, 27, 701, 702].map(columnName)).toEqual(["A", "Z", "AA", "AB", "ZZ", "AAA"]);
    expect(sheetNames(["Page 1", "a/b:c", "Page 1", ""])).toEqual(["Page 1", "a b c", "Page 1 2", "Sheet 4"]);
  });

  it("builds rows and aligned columns from fragments, including empty cells", () => {
    const f = (text: string, x: number, y: number) => ({ text, x, y, width: text.length * 5.5, fontSize: 11 });
    const rows = layoutTable([f("Item", 72, 700), f("Qty", 222, 700), f("Price", 372, 700), f("Total", 72, 680), f("9", 372, 680)]);
    expect(rows).toEqual([
      ["Item", "Qty", "Price"],
      ["Total", "", 9],
    ]);
  });
});

describe("pdfToXlsx", () => {
  it("converts a table PDF into a worksheet with numbers as numbers", async () => {
    const result = await pdfToXlsx(lib, await tablePdf(), "orders.pdf", quiet);
    expect(result.sheetCount).toBe(1);
    const xml = sheetXml(result.bytes);
    expect(xml).toContain('<c r="A1" t="inlineStr"><is><t xml:space="preserve">Item</t></is></c>');
    expect(xml).toContain('<c r="C2"><v>1250.5</v></c>');
    expect(xml).toContain('<c r="B3"><v>12</v></c>');
    expect(xml).toContain('<c r="C3"><v>0.99</v></c>');
    expect(xml).toContain('<c r="A4" t="inlineStr"><is><t xml:space="preserve">Order 007</t></is></c>');
    expect(xml).not.toContain('r="B4"');
  });

  it("refuses scanned PDFs", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([300, 300]).drawImage(await doc.embedPng(png(10, 10)), { x: 0, y: 0, width: 300, height: 300 });
    const error = await pdfToXlsx(lib, await doc.save(), "scan.pdf", quiet).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DocError);
    expect((error as DocError).code).toBe("no-text");
  });

  const soffice = ["C:\\Program Files\\LibreOffice\\program\\soffice.exe", "/usr/bin/soffice", "/Applications/LibreOffice.app/Contents/MacOS/soffice"].find(existsSync);
  it.skipIf(!soffice)("produces an XLSX a real spreadsheet app (LibreOffice) can open", { timeout: 180_000 }, async () => {
    const result = await pdfToXlsx(lib, await tablePdf(), "orders.pdf", quiet);
    const dir = mkdtempSync(join(tmpdir(), "doccraft-xlsx-"));
    try {
      writeFileSync(join(dir, "out.xlsx"), result.bytes);
      const profile = `file:///${join(dir, "profile").replace(/\\/g, "/")}`;
      execFileSync(soffice!, [`-env:UserInstallation=${profile}`, "--headless", "--convert-to", "csv", "--outdir", dir, join(dir, "out.xlsx")], { stdio: "ignore", timeout: 170_000 });
      const csv = readFileSync(join(dir, "out.csv"), "utf8");
      expect(csv).toContain("Apples,3,1250.5");
      expect(csv).toContain("Pears,12,0.99");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
