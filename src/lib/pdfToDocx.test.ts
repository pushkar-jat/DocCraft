import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strFromU8, unzipSync } from "fflate";
import { PDFDocument, StandardFonts } from "pdf-lib";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it } from "vitest";
import { makeEncryptedPdf, textBytes } from "../test/fixtures";
import { png } from "../test/imageFixtures";
import { buildDocx, xmlText } from "./docxWriter";
import { DocError } from "./errors";
import { pdfToDocx, type PdfJsLike } from "./pdfToDocx";
import { layoutPage } from "./textLayout";

const pdfjsLib = pdfjs as unknown as PdfJsLike;
const quiet = { documentParams: { verbosity: 0 } };

async function textPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page1 = doc.addPage([595, 842]);
  page1.drawText("Quarterly Report", { x: 72, y: 760, size: 24, font });
  page1.drawText("DocCraft converts documents on your own", { x: 72, y: 720, size: 11, font });
  page1.drawText("computer without uploading anything.", { x: 72, y: 706, size: 11, font });
  page1.drawText("A second paragraph & <special> characters.", { x: 72, y: 660, size: 11, font });
  const page2 = doc.addPage([595, 842]);
  page2.drawText("Page two keeps its own text and stays separate.", { x: 72, y: 760, size: 11, font });
  return doc.save();
}

async function scannedPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const image = await doc.embedPng(png(40, 40));
  doc.addPage([300, 300]).drawImage(image, { x: 0, y: 0, width: 300, height: 300 });
  return doc.save();
}

function documentXml(docx: Uint8Array): string {
  return strFromU8(unzipSync(docx)["word/document.xml"]);
}

describe("layoutPage", () => {
  it("joins nearby lines into a paragraph and detects large text as a heading", () => {
    const paragraphs = layoutPage([
      { text: "Title", x: 72, y: 760, width: 60, fontSize: 24 },
      { text: "First line of a para-", x: 72, y: 720, width: 200, fontSize: 11 },
      { text: "graph continues here.", x: 72, y: 706, width: 200, fontSize: 11 },
      { text: "Separate", x: 72, y: 660, width: 60, fontSize: 11 },
      { text: "words", x: 135, y: 660, width: 40, fontSize: 11 },
    ]);
    expect(paragraphs).toEqual([
      { text: "Title", fontSize: 24, heading: true },
      { text: "First line of a paragraph continues here.", fontSize: 11, heading: false },
      { text: "Separate words", fontSize: 11, heading: false },
    ]);
  });
});

describe("buildDocx", () => {
  it("escapes XML and strips characters XML cannot contain", () => {
    expect(xmlText('a & b < c > "d"\u0001')).toBe("a &amp; b &lt; c &gt; &quot;d&quot;");
  });

  it("produces a zip with the required parts", () => {
    const docx = buildDocx([[{ text: "Hello", fontSize: 11, heading: false }]], { width: 612, height: 792 }, "t");
    const parts = Object.keys(unzipSync(docx));
    expect(parts).toEqual(expect.arrayContaining(["[Content_Types].xml", "_rels/.rels", "word/document.xml", "word/styles.xml"]));
  });
});

describe("pdfToDocx", () => {
  it("extracts text, paragraphs, a heading and page breaks into a DOCX", async () => {
    const result = await pdfToDocx(pdfjsLib, await textPdf(), "report.pdf", quiet);
    expect(result.pageCount).toBe(2);
    const xml = documentXml(result.bytes);
    expect(xml).toContain("Quarterly Report");
    expect(xml).toContain("DocCraft converts documents on your own computer without uploading anything.");
    expect(xml).toContain("A second paragraph &amp; &lt;special&gt; characters.");
    expect(xml).toContain('<w:br w:type="page"/>');
    expect(xml.indexOf("Quarterly Report")).toBeLessThan(xml.indexOf("Page two keeps"));
    expect(xml).toMatch(/<w:b\/><w:sz w:val="48"\/>/); // the 24 pt heading
  });

  it("refuses scanned (image-only) PDFs instead of producing an empty document", async () => {
    const error = await pdfToDocx(pdfjsLib, await scannedPdf(), "scan.pdf", quiet).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DocError);
    expect((error as DocError).code).toBe("no-text");
    expect((error as DocError).message).toMatch(/OCR/);
  });

  it("reports invalid and encrypted PDFs", async () => {
    await expect(pdfToDocx(pdfjsLib, textBytes("not a pdf"), "x.pdf", quiet)).rejects.toMatchObject({ code: "not-pdf" });
    const encrypted = await pdfToDocx(pdfjsLib, await makeEncryptedPdf(), "secret.pdf", quiet).catch((e: unknown) => e);
    expect(encrypted).toBeInstanceOf(DocError);
    expect(["encrypted", "not-pdf"]).toContain((encrypted as DocError).code);
  });

  const soffice = ["C:\\Program Files\\LibreOffice\\program\\soffice.exe", "/usr/bin/soffice", "/Applications/LibreOffice.app/Contents/MacOS/soffice"].find(
    existsSync,
  );
  it.skipIf(!soffice)("produces a DOCX that a real word processor (LibreOffice) can open", { timeout: 180_000 }, async () => {
    const result = await pdfToDocx(pdfjsLib, await textPdf(), "report.pdf", quiet);
    const dir = mkdtempSync(join(tmpdir(), "doccraft-docx-"));
    try {
      writeFileSync(join(dir, "out.docx"), result.bytes);
      const profile = `file:///${join(dir, "profile").replace(/\\/g, "/")}`;
      execFileSync(soffice!, [`-env:UserInstallation=${profile}`, "--headless", "--convert-to", "txt:Text", "--outdir", dir, join(dir, "out.docx")], {
        stdio: "ignore",
        timeout: 170_000,
      });
      const text = readFileSync(join(dir, "out.txt"), "utf8");
      expect(text).toContain("Quarterly Report");
      expect(text).toContain("Page two keeps its own text");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
