import { useEffect, useState } from "react";
import type { DocumentComparison } from "../../lib/compare";
import { throwIfCancelled } from "../../lib/errors";
import type { FieldValue, FormInfo } from "../../lib/forms";
import { fileNameFromPath } from "../../lib/paths";
import { comparisonReport, wordDiff, type Hunk } from "../../lib/textDiff";
import { comparePdfs, pdfToExcel } from "../../services/operations";
import { chooseSavePath, suggestedPath } from "../../services/output";
import { runPdfWorker } from "../../services/pdfWorkerClient";
import { PDF_FILTER, readInput, writeOutput } from "../../services/tauriFiles";
import { useJob } from "../../state/useJob";
import { usePdfSource } from "../../state/usePdfSource";
import { JobStatus } from "../JobStatus";
import { ActionBar, SingleFilePicker, ToolLayout } from "../ToolLayout";
import { PdfToolShell } from "./PdfToolShell";

type BackProps = { onBack: () => void };

// ---------------------------------------------------------------- PDF to Excel

export function PdfToExcelView({ onBack }: BackProps) {
  const job = useJob();
  const pdf = usePdfSource(job);
  return (
    <PdfToolShell
      title="PDF to Excel"
      description="Rebuild tables from a PDF as an Excel workbook — one worksheet per page, numbers as real numbers."
      onBack={onBack}
      job={job}
      source={pdf.source}
      sourceDetail={pdf.detail}
      onChoose={pdf.choose}
      actionLabel="Convert to Excel"
      blocker={null}
      notice={
        <div className="status status--info">
          <strong>Basic layout.</strong> Rows and columns are rebuilt from where text sits on the page. Simple tables work well; merged cells, rotated text
          and cells with several lines may be split. Scanned PDFs need OCR first.
        </div>
      }
      onRun={() =>
        job.run(async (context) => {
          const source = pdf.source;
          if (!source) return null;
          const output = await chooseSavePath(context, {
            title: "Save Excel workbook as",
            suggested: suggestedPath(source.path, "", "xlsx"),
            filters: [{ name: "Excel workbook", extensions: ["xlsx"] }],
            inputs: [source.path],
            extension: "xlsx",
          });
          if (output === null) return null;
          const result = await pdfToExcel(await readInput(source.path), source.name, {
            signal: context.signal,
            onProgress: (p) => context.progress(`Reading page ${p.current} of ${p.total}…`, (p.current / p.total) * 95),
          });
          throwIfCancelled(context.signal);
          context.progress("Saving…", null, false);
          await writeOutput(output, result.bytes);
          return {
            title: `Saved ${fileNameFromPath(output)}.`,
            details: [`${result.sheetCount} ${result.sheetCount === 1 ? "worksheet" : "worksheets"}, ${result.cellCount.toLocaleString()} filled cells.`],
            warning: "Check totals and column alignment against the original.",
          };
        })
      }
    />
  );
}

// ---------------------------------------------------------------- Compare

function HunkView({ hunk, index }: { hunk: Hunk; index: number }) {
  const before = hunk.removed.map((line) => line.text).join("\n");
  const after = hunk.added.map((line) => line.text).join("\n");
  const words = hunk.removed.length > 0 && hunk.added.length > 0 ? wordDiff(before, after) : null;
  const pages = (lines: Hunk["removed"]) => [...new Set(lines.map((line) => line.page))].join(", ");
  return (
    <li className="diff-hunk">
      <div className="diff-side diff-side--removed">
        <span className="diff-label">{hunk.removed.length ? `Original · page ${pages(hunk.removed)}` : "Original"}</span>
        <p className="diff-text">
          {hunk.removed.length === 0 ? (
            <em>(nothing — text was added)</em>
          ) : words ? (
            words.before.map((part, i) => (part.changed ? <del key={i}>{part.text}</del> : <span key={i}>{part.text}</span>))
          ) : (
            <del>{before}</del>
          )}
        </p>
      </div>
      <div className="diff-side diff-side--added">
        <span className="diff-label">{hunk.added.length ? `Changed · page ${pages(hunk.added)}` : "Changed"}</span>
        <p className="diff-text">
          {hunk.added.length === 0 ? (
            <em>(nothing — text was removed)</em>
          ) : words ? (
            words.after.map((part, i) => (part.changed ? <ins key={i}>{part.text}</ins> : <span key={i}>{part.text}</span>))
          ) : (
            <ins>{after}</ins>
          )}
        </p>
      </div>
      <span className="visually-hidden">Change {index + 1}</span>
    </li>
  );
}

export function CompareView({ onBack }: BackProps) {
  const job = useJob();
  const first = usePdfSource(job, "Select the original PDF");
  const second = usePdfSource(job, "Select the changed PDF");
  const [result, setResult] = useState<DocumentComparison | null>(null);

  useEffect(() => setResult(null), [first.source, second.source]);

  const compare = () =>
    job.run(async (context) => {
      if (!first.source || !second.source) return null;
      setResult(null);
      context.progress("Reading both documents…");
      const comparison = await comparePdfs(
        { name: first.source.name, bytes: await readInput(first.source.path) },
        { name: second.source.name, bytes: await readInput(second.source.path) },
        { signal: context.signal },
      );
      setResult(comparison);
      return comparison.identical
        ? { title: "No text differences found.", details: ["Only the text is compared; images and layout are not."], tone: "info" }
        : { title: `Found ${comparison.hunks.length} ${comparison.hunks.length === 1 ? "change" : "changes"}.`, details: [`${comparison.removedLines} lines removed or changed, ${comparison.addedLines} added or changed.`] };
    });

  const saveReport = () =>
    job.run(async (context) => {
      if (!result || !first.source || !second.source) return null;
      const output = await chooseSavePath(context, {
        title: "Save comparison report as",
        suggested: suggestedPath(second.source.path, "_comparison", "txt"),
        filters: [{ name: "Text report", extensions: ["txt"] }],
        inputs: [first.source.path, second.source.path],
        extension: "txt",
      });
      if (output === null) return null;
      await writeOutput(output, new TextEncoder().encode(comparisonReport(first.source.name, second.source.name, result)));
      return { title: `Saved ${fileNameFromPath(output)}.` };
    });

  return (
    <ToolLayout title="Compare PDF" description="Find the text differences between two versions of a document, page by page." onBack={onBack} busy={job.busy}>
      <SingleFilePicker label="Select the original PDF" fileName={first.source ? `Original: ${first.source.name}` : null} detail={first.detail} onChoose={first.choose} disabled={job.busy} />
      <SingleFilePicker label="Select the changed PDF" fileName={second.source ? `Changed: ${second.source.name}` : null} detail={second.detail} onChoose={second.choose} disabled={job.busy} />
      <JobStatus job={job} />
      {result && !result.identical && (
        <div className="panel">
          <div className="panel-toolbar">
            <span className="panel-count">
              {result.hunks.length} {result.hunks.length === 1 ? "change" : "changes"}
            </span>
            <button type="button" className="button button--secondary" onClick={saveReport} disabled={job.busy}>
              Save report…
            </button>
          </div>
          <ol className="diff-list" aria-label="Differences">
            {result.hunks.slice(0, 500).map((hunk, index) => (
              <HunkView key={index} hunk={hunk} index={index} />
            ))}
          </ol>
          {result.hunks.length > 500 && <p className="notice">Showing the first 500 changes. Save the report to see all of them.</p>}
        </div>
      )}
      <ActionBar hint={!first.source || !second.source ? "Choose both PDFs to compare." : "Ready. Only the text is compared, not images or layout."}>
        <button type="button" className="button button--primary button--large" onClick={compare} disabled={job.busy || !first.source || !second.source}>
          Compare
        </button>
      </ActionBar>
    </ToolLayout>
  );
}

// ---------------------------------------------------------------- PDF Forms

export function FormsView({ onBack }: BackProps) {
  const job = useJob();
  const pdf = usePdfSource(job, "Select a PDF form");
  const [form, setForm] = useState<FormInfo | null>(null);
  const [values, setValues] = useState<Record<string, FieldValue>>({});
  const [flatten, setFlatten] = useState(false);

  useEffect(() => {
    setForm(null);
    setValues({});
    const source = pdf.source;
    if (!source) return;
    job.run(async (context) => {
      context.progress("Reading the form fields…");
      const result = await runPdfWorker({ op: "readForm", input: { name: source.name, bytes: await readInput(source.path) } }, { signal: context.signal });
      const info = result.form!;
      setForm(info);
      const initial: Record<string, FieldValue> = {};
      for (const field of info.fields) {
        if (field.kind === "text") initial[field.name] = field.value;
        else if (field.kind === "checkbox") initial[field.name] = field.checked;
        else if (field.kind === "radio") initial[field.name] = field.selected ?? "";
        else if (field.kind === "choice") initial[field.name] = field.selected;
      }
      setValues(initial);
      return info.fields.length === 0 ? { title: "This PDF has no fillable fields.", details: ["To add text to any PDF, use Edit PDF."], tone: "info" } : null;
    });
    // job.run is stable; re-run only when a new PDF is chosen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdf.source]);

  const set = (name: string, value: FieldValue) => setValues((current) => ({ ...current, [name]: value }));
  const editable = form?.fields.filter((field) => field.kind !== "other") ?? [];

  return (
    <PdfToolShell
      title="PDF Forms"
      description="Fill in a PDF form's fields and save a copy — optionally flattened so the answers can no longer be changed."
      onBack={onBack}
      job={job}
      source={pdf.source}
      sourceDetail={form ? `${form.fields.length} ${form.fields.length === 1 ? "field" : "fields"}` : pdf.detail}
      onChoose={pdf.choose}
      actionLabel="Save filled form"
      blocker={!form ? "Reading the form…" : editable.length === 0 ? "This PDF has no fillable fields." : null}
      onRun={() =>
        job.run(async (context) => {
          const source = pdf.source;
          if (!source || !form) return null;
          const output = await chooseSavePath(context, {
            title: "Save filled form as",
            suggested: suggestedPath(source.path, flatten ? "_filled_flat" : "_filled", "pdf"),
            filters: PDF_FILTER,
            inputs: [source.path],
            extension: "pdf",
          });
          if (output === null) return null;
          context.progress("Filling the form…");
          const result = await runPdfWorker({ op: "fillForm", input: { name: source.name, bytes: await readInput(source.path) }, values, flatten }, { signal: context.signal });
          throwIfCancelled(context.signal);
          context.progress("Saving…", null, false);
          await writeOutput(output, result.outputs[0]);
          return { title: `Saved ${fileNameFromPath(output)}.`, details: [flatten ? "The answers are now part of the page and cannot be edited." : "The fields can still be edited in any PDF reader."] };
        })
      }
    >
      {() =>
        form && (
          <>
            {form.hasXfa && (
              <p className="field-help">
                This form also contains a dynamic (XFA) version, which DocCraft cannot display. The standard fields below will be filled and the XFA part removed.
              </p>
            )}
            <div className="form-fields">
              {form.fields.map((field) => (
                <div key={field.name} className="field">
                  {field.kind === "text" && (
                    <label>
                      {field.name}
                      {field.multiline ? (
                        <textarea className="text-input" rows={3} value={String(values[field.name] ?? "")} readOnly={field.readOnly} maxLength={field.maxLength ?? undefined} onChange={(e) => set(field.name, e.target.value)} />
                      ) : (
                        <input className="text-input" value={String(values[field.name] ?? "")} readOnly={field.readOnly} maxLength={field.maxLength ?? undefined} onChange={(e) => set(field.name, e.target.value)} />
                      )}
                    </label>
                  )}
                  {field.kind === "checkbox" && (
                    <label className="choice">
                      <input type="checkbox" checked={Boolean(values[field.name])} disabled={field.readOnly} onChange={(e) => set(field.name, e.target.checked)} /> {field.name}
                    </label>
                  )}
                  {field.kind === "radio" && (
                    <fieldset className="choice-row" disabled={field.readOnly}>
                      <legend>{field.name}</legend>
                      {field.options.map((option) => (
                        <label key={option} className="choice">
                          <input type="radio" name={`radio-${field.name}`} checked={values[field.name] === option} onChange={() => set(field.name, option)} /> {option}
                        </label>
                      ))}
                    </fieldset>
                  )}
                  {field.kind === "choice" && (
                    <label>
                      {field.name}
                      <select
                        className="select"
                        multiple={field.multiple}
                        disabled={field.readOnly}
                        value={field.multiple ? (values[field.name] as string[]) : ((values[field.name] as string[])?.[0] ?? "")}
                        onChange={(e) => set(field.name, field.multiple ? [...e.target.selectedOptions].map((o) => o.value) : e.target.value ? [e.target.value] : [])}
                      >
                        {!field.multiple && <option value="">(none)</option>}
                        {field.options.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  {field.kind === "other" && (
                    <span className="field-help">
                      {field.name}: {field.description}
                    </span>
                  )}
                </div>
              ))}
            </div>
            <label className="choice">
              <input type="checkbox" checked={flatten} onChange={(e) => setFlatten(e.target.checked)} /> Flatten — make the answers part of the page so they cannot be changed
            </label>
          </>
        )
      }
    </PdfToolShell>
  );
}
