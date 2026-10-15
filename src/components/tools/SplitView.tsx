import { useId, useState } from "react";
import { throwIfCancelled } from "../../lib/errors";
import { baseName } from "../../lib/naming";
import { chunkRanges, formatRange, parsePageRanges, type PageRange } from "../../lib/pageRanges";
import { fileNameFromPath, pathKey } from "../../lib/paths";
import { chooseSavePath, suggestedPath } from "../../services/output";
import { runPdfWorker } from "../../services/pdfWorkerClient";
import { freeOutputPath, pickFile, pickFolder, PDF_FILTER, readInput, writeOutput } from "../../services/tauriFiles";
import { useJob } from "../../state/useJob";
import { JobStatus } from "../JobStatus";
import { ActionBar, SingleFilePicker, ToolLayout } from "../ToolLayout";

export type SplitMode = "split" | "extract";

interface Source {
  path: string;
  name: string;
  pageCount: number;
}

export function SplitView({ mode, onBack }: { mode: SplitMode; onBack: () => void }) {
  const job = useJob();
  const [source, setSource] = useState<Source | null>(null);
  const [rangeText, setRangeText] = useState("");
  const [method, setMethod] = useState<"ranges" | "every">(mode === "split" ? "every" : "ranges");
  const [every, setEvery] = useState(1);
  const rangeId = useId();

  const parsed = source && method === "ranges" ? parsePageRanges(rangeText, source.pageCount) : null;
  const ranges: PageRange[] | null = !source ? null : method === "every" ? chunkRanges(source.pageCount, every) : parsed?.ok ? parsed.ranges : null;
  const rangeError = parsed && !parsed.ok && rangeText.trim() !== "" ? parsed.error : null;

  const choose = () =>
    job.run(async (context) => {
      context.progress("Choose a PDF in the dialog.", null, false);
      const path = await pickFile("Select a PDF", PDF_FILTER);
      if (path === null) return null;
      context.progress("Reading the PDF…");
      const bytes = await readInput(path);
      const { pageCount } = await runPdfWorker({ op: "pageCount", input: { name: fileNameFromPath(path), bytes } }, { signal: context.signal });
      setSource({ path, name: fileNameFromPath(path), pageCount });
      setRangeText("");
      return null;
    });

  const run = () =>
    job.run(async (context) => {
      if (!source || !ranges) return null;
      if (mode === "extract") {
        const output = await chooseSavePath(context, {
          title: "Save extracted pages as",
          suggested: suggestedPath(source.path, "_pages", "pdf"),
          filters: PDF_FILTER,
          inputs: [source.path],
          extension: "pdf",
        });
        if (output === null) return null;
        context.progress("Extracting pages…");
        const bytes = await readInput(source.path);
        const result = await runPdfWorker({ op: "extract", input: { name: source.name, bytes }, ranges }, { signal: context.signal });
        throwIfCancelled(context.signal);
        context.progress("Saving…", null, false);
        await writeOutput(output, result.outputs[0]);
        const pages = ranges.reduce((sum, range) => sum + range.end - range.start + 1, 0);
        return { title: `Extracted ${pages} ${pages === 1 ? "page" : "pages"} into ${fileNameFromPath(output)}.`, details: [`Pages: ${ranges.map(formatRange).join(", ")}`] };
      }

      context.progress("Choose a folder for the split files in the dialog.", null, false);
      const folder = await pickFolder("Choose a folder for the split PDFs");
      if (folder === null) return null;
      const bytes = await readInput(source.path);
      const result = await runPdfWorker(
        { op: "split", input: { name: source.name, bytes }, ranges },
        { signal: context.signal, onProgress: (p) => context.progress(`Creating file ${p.current} of ${p.total}…`, (p.current / p.total) * 90) },
      );
      throwIfCancelled(context.signal);
      context.progress("Saving files…", 95, false);
      const reserved = new Set<string>();
      const names: string[] = [];
      for (const [index, output] of result.outputs.entries()) {
        const path = await freeOutputPath(folder, `${baseName(source.name)}_pages_${formatRange(ranges[index])}`, "pdf", reserved);
        reserved.add(pathKey(path));
        await writeOutput(path, output);
        names.push(fileNameFromPath(path));
      }
      return {
        title: `Created ${names.length} ${names.length === 1 ? "file" : "files"} in “${fileNameFromPath(folder)}”.`,
        details: names.length <= 8 ? names : [...names.slice(0, 8), `…and ${names.length - 8} more`],
      };
    });

  const blocker = !source
    ? "Choose a PDF to start."
    : method === "ranges" && rangeText.trim() === ""
      ? "Enter the pages to use."
      : rangeError ?? (ranges && mode === "split" ? `Will create ${ranges.length} ${ranges.length === 1 ? "file" : "files"}.` : null);

  const title = mode === "split" ? "Split PDF" : "Extract pages";
  return (
    <ToolLayout
      title={title}
      description={
        mode === "split"
          ? "Split one PDF into several files, one per page range. The original is never changed."
          : "Copy selected pages, in the order you type them, into a new PDF. The original is never changed."
      }
      onBack={onBack}
      busy={job.busy}
    >
      <SingleFilePicker
        label="Select a PDF"
        fileName={source?.name ?? null}
        detail={source ? `${source.pageCount} ${source.pageCount === 1 ? "page" : "pages"}` : null}
        onChoose={choose}
        disabled={job.busy}
      />

      {source && (
        <fieldset className="panel form-panel" disabled={job.busy}>
          <legend className="form-legend">Pages (numbered from 1)</legend>
          {mode === "split" && (
            <div className="choice-row">
              <label className="choice">
                <input type="radio" name="split-method" checked={method === "every"} onChange={() => setMethod("every")} />
                Every
                <input
                  type="number"
                  className="number-input"
                  min={1}
                  max={source.pageCount}
                  value={every}
                  onChange={(event) => setEvery(Math.max(1, Math.min(source.pageCount, Number(event.target.value) || 1)))}
                  aria-label="Pages per file"
                />
                {every === 1 ? "page" : "pages"} per file
              </label>
              <label className="choice">
                <input type="radio" name="split-method" checked={method === "ranges"} onChange={() => setMethod("ranges")} />
                Custom ranges (one file per range)
              </label>
            </div>
          )}
          {method === "ranges" && (
            <div className="field">
              <label htmlFor={rangeId}>{mode === "split" ? "Ranges" : "Pages to extract"}</label>
              <input
                id={rangeId}
                className="text-input"
                value={rangeText}
                onChange={(event) => setRangeText(event.target.value)}
                placeholder={mode === "split" ? "e.g. 1-3, 4-6, 7-10" : "e.g. 3, 1, 5-8"}
                aria-invalid={rangeError !== null}
                aria-describedby={`${rangeId}-help`}
              />
              <p id={`${rangeId}-help`} className={rangeError ? "field-error" : "field-help"} aria-live="polite">
                {rangeError ?? `Pages 1 to ${source.pageCount}. Separate entries with commas; each page may appear once.`}
              </p>
            </div>
          )}
        </fieldset>
      )}

      <JobStatus job={job} />

      <ActionBar hint={blocker ?? "Ready."}>
        <button type="button" className="button button--primary button--large" onClick={run} disabled={job.busy || !ranges}>
          {mode === "split" ? "Split PDF" : "Extract pages"}
        </button>
      </ActionBar>
    </ToolLayout>
  );
}

