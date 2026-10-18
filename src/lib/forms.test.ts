import { PDFDocument } from "pdf-lib";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it } from "vitest";
import { makePdf } from "../test/fixtures";
import { fillForm, readForm } from "./forms";

async function formPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const form = doc.getForm();
  form.createTextField("full_name").addToPage(page, { x: 72, y: 700, width: 250, height: 22 });
  form.createCheckBox("agree").addToPage(page, { x: 72, y: 660, width: 16, height: 16 });
  const radio = form.createRadioGroup("plan");
  radio.addOptionToPage("basic", page, { x: 72, y: 620, width: 14, height: 14 });
  radio.addOptionToPage("pro", page, { x: 120, y: 620, width: 14, height: 14 });
  const dropdown = form.createDropdown("country");
  dropdown.addOptions(["India", "Germany", "Japan"]);
  dropdown.addToPage(page, { x: 72, y: 580, width: 150, height: 22 });
  const locked = form.createTextField("office_use");
  locked.setText("DO NOT EDIT");
  locked.enableReadOnly();
  locked.addToPage(page, { x: 72, y: 540, width: 150, height: 22 });
  return doc.save();
}

async function pageText(bytes: Uint8Array): Promise<string> {
  const doc = await pdfjs.getDocument({ data: bytes.slice(), verbosity: 0 }).promise;
  const content = await (await doc.getPage(1)).getTextContent();
  return content.items.map((item) => ("str" in item ? item.str : "")).join(" ");
}

describe("forms", () => {
  it("reads every field with its type and current value", async () => {
    const info = await readForm({ name: "f.pdf", bytes: await formPdf() });
    expect(info.hasXfa).toBe(false);
    expect(info.fields.map((f) => [f.kind, f.name])).toEqual([
      ["text", "full_name"],
      ["checkbox", "agree"],
      ["radio", "plan"],
      ["choice", "country"],
      ["text", "office_use"],
    ]);
    const plan = info.fields.find((f) => f.name === "plan");
    expect(plan).toMatchObject({ options: ["basic", "pro"], selected: null });
  });

  it("fills fields and keeps them editable", async () => {
    const filled = await fillForm(
      { name: "f.pdf", bytes: await formPdf() },
      { full_name: "Asha Rao", agree: true, plan: "pro", country: ["Japan"], office_use: "hacked" },
      { flatten: false },
    );
    const info = await readForm({ name: "f.pdf", bytes: filled });
    const value = (name: string) => info.fields.find((f) => f.name === name);
    expect(value("full_name")).toMatchObject({ value: "Asha Rao" });
    expect(value("agree")).toMatchObject({ checked: true });
    expect(value("plan")).toMatchObject({ selected: "pro" });
    expect(value("country")).toMatchObject({ selected: ["Japan"] });
    expect(value("office_use")).toMatchObject({ value: "DO NOT EDIT" }); // read-only fields are not changed
  });

  it("flattens values into page content", async () => {
    const flat = await fillForm({ name: "f.pdf", bytes: await formPdf() }, { full_name: "Asha Rao", country: ["Germany"] }, { flatten: true });
    expect((await readForm({ name: "f.pdf", bytes: flat })).fields).toEqual([]);
    const text = await pageText(flat);
    expect(text).toContain("Asha Rao");
    expect(text).toContain("Germany");
  });

  it("rejects PDFs without a form and invalid choices", async () => {
    await expect(fillForm({ name: "plain.pdf", bytes: await makePdf(1, 1) }, {}, { flatten: false })).rejects.toMatchObject({ code: "unsupported" });
    await expect(fillForm({ name: "f.pdf", bytes: await formPdf() }, { plan: "enterprise" }, { flatten: false })).rejects.toMatchObject({ code: "invalid-range" });
  });

  it("explains characters the form font cannot show", async () => {
    await expect(fillForm({ name: "f.pdf", bytes: await formPdf() }, { full_name: "शर्मा" }, { flatten: true })).rejects.toMatchObject({ code: "unsupported" });
  });
});
