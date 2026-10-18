import { PDFDocument, StandardFonts } from "pdf-lib";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it } from "vitest";
import { paragraphsToMarkdown } from "./markdown";
import { extractText, type PdfJsLike } from "./pdfToDocx";
import { layoutPage } from "./textLayout";

const p = (text: string, fontSize = 11, heading = false) => ({ text, fontSize, heading });

describe("paragraphsToMarkdown", () => {
  it("writes headings by relative size, paragraphs, lists and page rules", () => {
    const md = paragraphsToMarkdown([
      [p("Annual Report", 24, true), p("Intro text with *stars* and _underscores_."), p("Results", 16, true), p("• first"), p("• second"), p("After the list.")],
      [p("1. one"), p("2. two")],
    ]);
    expect(md).toBe(
      [
        "# Annual Report",
        "",
        "Intro text with \\*stars\\* and \\_underscores\\_.",
        "",
        "## Results",
        "",
        "- first",
        "- second",
        "",
        "After the list.",
        "",
        "---",
        "",
        "1. one",
        "2. two",
        "",
      ].join("\n"),
    );
  });

  it("escapes text that would accidentally become Markdown syntax", () => {
    expect(paragraphsToMarkdown([[p("# not a heading"), p("2023. was a year")]], { pageSeparators: false })).toBe("\\# not a heading\n\n2023\\. was a year\n");
  });
});

describe("layoutPage list handling", () => {
  it("keeps bullet lines as separate paragraphs", () => {
    const paragraphs = layoutPage([
      { text: "• alpha", x: 72, y: 700, width: 40, fontSize: 11 },
      { text: "• beta", x: 72, y: 686, width: 40, fontSize: 11 },
      { text: "continued sentence", x: 72, y: 672, width: 90, fontSize: 11 },
    ]);
    expect(paragraphs.map((x) => x.text)).toEqual(["• alpha", "• beta continued sentence"]);
  });
});

describe("PDF to Markdown end to end", () => {
  it("converts a real PDF with a heading and bullets", async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([595, 842]);
    page.drawText("Project Plan", { x: 72, y: 760, size: 24, font });
    page.drawText("- Gather requirements", { x: 72, y: 720, size: 11, font });
    page.drawText("- Build the prototype", { x: 72, y: 706, size: 11, font });
    page.drawText("Everything runs locally.", { x: 72, y: 670, size: 11, font });
    const extracted = await extractText(pdfjs as unknown as PdfJsLike, await doc.save(), "plan.pdf", { documentParams: { verbosity: 0 } });
    expect(paragraphsToMarkdown(extracted.pages)).toBe("# Project Plan\n\n- Gather requirements\n- Build the prototype\n\nEverything runs locally.\n");
  });
});
