import {
  PDFCheckBox,
  PDFDropdown,
  PDFOptionList,
  PDFRadioGroup,
  PDFSignature,
  PDFTextField,
  PDFButton,
  type PDFField,
  type PDFForm,
} from "pdf-lib";
import { DocError, throwIfCancelled } from "./errors";
import { loadPdf, type PdfInput } from "./merge";

export type FormField =
  | { kind: "text"; name: string; value: string; multiline: boolean; maxLength: number | null; readOnly: boolean }
  | { kind: "checkbox"; name: string; checked: boolean; readOnly: boolean }
  | { kind: "radio"; name: string; options: string[]; selected: string | null; readOnly: boolean }
  | { kind: "choice"; name: string; options: string[]; selected: string[]; multiple: boolean; readOnly: boolean }
  | { kind: "other"; name: string; description: string };

export type FieldValue = string | boolean | string[];

export interface FormInfo {
  fields: FormField[];
  /** Dynamic XFA forms cannot be filled with standard PDF form tools. */
  hasXfa: boolean;
}

function describe(field: PDFField): FormField {
  const name = field.getName();
  const readOnly = field.isReadOnly();
  if (field instanceof PDFTextField) {
    return { kind: "text", name, value: field.getText() ?? "", multiline: field.isMultiline(), maxLength: field.getMaxLength() ?? null, readOnly };
  }
  if (field instanceof PDFCheckBox) return { kind: "checkbox", name, checked: field.isChecked(), readOnly };
  if (field instanceof PDFRadioGroup) return { kind: "radio", name, options: field.getOptions(), selected: field.getSelected() ?? null, readOnly };
  if (field instanceof PDFDropdown) return { kind: "choice", name, options: field.getOptions(), selected: field.getSelected(), multiple: field.isMultiselect(), readOnly };
  if (field instanceof PDFOptionList) return { kind: "choice", name, options: field.getOptions(), selected: field.getSelected(), multiple: field.isMultiselect(), readOnly };
  if (field instanceof PDFSignature) return { kind: "other", name, description: "Signature field — use Sign PDF" };
  if (field instanceof PDFButton) return { kind: "other", name, description: "Button" };
  return { kind: "other", name, description: "Unsupported field type" };
}

function formOf(doc: Awaited<ReturnType<typeof loadPdf>>): PDFForm {
  try {
    return doc.getForm();
  } catch {
    throw new DocError("unsupported", "This PDF's form is damaged and cannot be read.");
  }
}

export async function readForm(input: PdfInput): Promise<FormInfo> {
  const doc = await loadPdf(input);
  const form = formOf(doc);
  return { fields: form.getFields().map(describe), hasXfa: form.hasXFA() };
}

/**
 * Fills fields by name. With `flatten`, values become ordinary page content and the form can no
 * longer be edited. XFA data is removed so readers show the filled standard (AcroForm) fields.
 */
export async function fillForm(input: PdfInput, values: Record<string, FieldValue>, options: { flatten: boolean; signal?: AbortSignal }): Promise<Uint8Array> {
  const doc = await loadPdf(input);
  const form = formOf(doc);
  if (form.getFields().length === 0) throw new DocError("unsupported", `"${input.name}" has no fillable form fields.`, input.name);
  if (form.hasXFA()) form.deleteXFA();

  for (const [name, value] of Object.entries(values)) {
    throwIfCancelled(options.signal);
    let field: PDFField;
    try {
      field = form.getField(name);
    } catch {
      continue; // Unknown names are ignored; the UI only sends fields it read.
    }
    if (field.isReadOnly()) continue;
    try {
      if (field instanceof PDFTextField && typeof value === "string") {
        const max = field.getMaxLength();
        field.setText(max !== undefined ? value.slice(0, max) : value);
      } else if (field instanceof PDFCheckBox && typeof value === "boolean") {
        if (value) field.check();
        else field.uncheck();
      } else if (field instanceof PDFRadioGroup && typeof value === "string") {
        if (value === "") field.clear();
        else field.select(value);
      } else if ((field instanceof PDFDropdown || field instanceof PDFOptionList) && Array.isArray(value)) {
        if (value.length === 0) field.clear();
        else field.select(value.length === 1 ? value[0] : value);
      }
    } catch {
      throw new DocError("invalid-range", `The value for "${name}" is not allowed by the form.`);
    }
  }

  try {
    if (options.flatten) form.flatten();
    else form.updateFieldAppearances();
  } catch {
    throw new DocError(
      "unsupported",
      "Some entered text uses characters the form's font cannot display (for example non-Latin scripts). Use Latin characters, or fill the form in a full PDF editor.",
    );
  }
  throwIfCancelled(options.signal);
  doc.setProducer("DocCraft");
  return doc.save();
}
