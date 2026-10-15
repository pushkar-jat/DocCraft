import { useRef, useState } from "react";
import { addBatchItems, requeueUnfinished, runBatch, summarize, type BatchItem, type BatchProcessor } from "../../lib/batch";
import { throwIfCancelled } from "../../lib/errors";
import { baseName, extensionOf, formatBytes } from "../../lib/naming";
import { fileNameFromPath, pathKey } from "../../lib/paths";
import { compressPdf, ocrPdfFile, pdfToWord, wordToPdf, type CompressPreset } from "../../services/operations";
import { freeOutputPath, PDF_FILTER, pickFiles, pickFolder, readInput, WORD_FILTER, writeOutput } from "../../services/tauriFiles";
import { useEngines } from "../../state/EnginesContext";
import { PlusIcon, TrashIcon } from "../Icons";
import { ActionBar, ToolLayout } from "../ToolLayout";

type Operation = "compress" | "word-to-pdf" | "pdf-to-word" | "ocr";

const OPERATIONS: Record<Operation, { label: string; extensions: string[]; engine?: "libreOffice" | "tesseract" }> = {
  compress: { label: "Compress PDFs", extensions: ["pdf"] },
  "pdf-to-word": { label: "PDF to Word (basic layout)", extensions: ["pdf"] },
  "word-to-pdf": { label: "Word to PDF", extensions: ["docx", "doc", "odt", "rtf"], engine: "libreOffice" },
  ocr: { label: "OCR to searchable PDF", extensions: ["pdf"], engine: "tesseract" },
};

const STATUS_LABEL: Record<BatchItem["status"], string> = {
  queued: "Queued",
  processing: "Processing…",
  succeeded: "Done",
  failed: "Failed",
  cancelled: "Cancelled",
};

export function BatchView({ onBack }: { onBack: () => void }) {
  const { status } = useEngines();
  const [operation, setOperation] = useState<Operation>("compress");
  const [preset, setPreset] = useState<CompressPreset>("balanced");
  const [items, setItems] = useState<BatchItem[]>([]);
  const [folder, setFolder] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [finished, setFinished] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);

  const config = OPERATIONS[operation];
  const engineMissing = config.engine !== undefined && !(status?.[config.engine].available ?? false);
  const language = status?.tesseract.languages.includes("eng") ? "eng" : (status?.tesseract.languages[0] ?? "eng");
  const queued = items.filter((item) => item.status === "queued").length;
  const summary = summarize(items);

  const chooseOperation = (next: Operation) => {
    setOperation(next);
    setItems([]);
    setNotice(null);
    setFinished(false);
  };

  const addItems = async () => {
    let paths: string[];
    try {
      paths = await pickFiles("Add files to the batch", operation === "word-to-pdf" ? WORD_FILTER : PDF_FILTER);
    } catch {
      setNotice("The file picker could not be opened. Please try again.");
      return;
    }
    const result = addBatchItems(items, paths, config.extensions);
    setItems(result.items);
    setFinished(false);
    const skipped = [...result.duplicates.map((name) => `${name} (already queued)`), ...result.rejected.map((name) => `${name} (wrong type)`)];
    setNotice(skipped.length ? `Skipped: ${skipped.join(", ")}.` : null);
  };

  const chooseFolder = async () => {
    try {
      const picked = await pickFolder("Choose the output folder");
      if (picked !== null) setFolder(picked);
    } catch {
      setNotice("The folder picker could not be opened. Please try again.");
    }
  };

  const clear = () => {
    setItems([]);
    setFinished(false);
  };

  const retry = () => {
    setItems(requeueUnfinished);
    setFinished(false);
  };

  const processor = (outputFolder: string): BatchProcessor => {
    const reserved = new Set<string>();
    return async (item, signal) => {
      const input = await readInput(item.path);
      let output: Uint8Array;
      let stem = baseName(item.name);
      let extension = "pdf";
      switch (operation) {
        case "compress":
          output = await compressPdf(input, preset, { signal });
          if (output.length >= input.length) {
            return `Already compact (${formatBytes(input.length)}); no smaller version, nothing written.`;
          }
          stem += "_compressed";
          break;
        case "word-to-pdf":
          output = await wordToPdf(input, extensionOf(item.name), { signal });
          break;
        case "pdf-to-word":
          output = (await pdfToWord(input, item.name, { signal })).bytes;
          extension = "docx";
          break;
        case "ocr":
          output = await ocrPdfFile(input, item.name, [language], { signal });
          stem += "_searchable";
          break;
      }
      throwIfCancelled(signal);
      // Never overwrite: existing files (including the inputs) and names used earlier in this run are skipped.
      const path = await freeOutputPath(outputFolder, stem, extension, reserved);
      reserved.add(pathKey(path));
      await writeOutput(path, output);
      return fileNameFromPath(path);
    };
  };

  const start = async () => {
    if (!folder || running) return;
    const controller = new AbortController();
    controllerRef.current = controller;
    setRunning(true);
    setFinished(false);
    try {
      await runBatch(items, processor(folder), { signal: controller.signal, onUpdate: setItems });
    } finally {
      controllerRef.current = null;
      setRunning(false);
      setFinished(true);
    }
  };

  const cancel = () => controllerRef.current?.abort();

  return (
    <ToolLayout
      title="Batch processing"
      description="Run one operation on many files. Files are processed one at a time; a failure only affects its own file."
      onBack={onBack}
      busy={running}
    >
      <fieldset className="panel form-panel" disabled={running}>
        <legend className="form-legend">Operation</legend>
        <div className="choice-row">
          <label className="inline-field">
            Operation
            <select className="select" value={operation} onChange={(event) => chooseOperation(event.target.value as Operation)}>
              {(Object.keys(OPERATIONS) as Operation[]).map((id) => {
                const engine = OPERATIONS[id].engine;
                const missing = engine !== undefined && !(status?.[engine].available ?? false);
                return (
                  <option key={id} value={id} disabled={missing}>
                    {OPERATIONS[id].label}
                    {missing ? ` — needs ${engine === "libreOffice" ? "LibreOffice" : "Tesseract"}` : ""}
                  </option>
                );
              })}
            </select>
          </label>
          {operation === "compress" && (
            <label className="inline-field">
              Level
              <select className="select" value={preset} onChange={(event) => setPreset(event.target.value as CompressPreset)}>
                <option value="high">Higher quality (lossless)</option>
                <option value="balanced">Balanced</option>
                <option value="small">Smaller file</option>
              </select>
            </label>
          )}
          {operation === "ocr" && <span className="field-help">Language: {language}</span>}
        </div>
        <div className="choice-row">
          <button type="button" className="button button--secondary" onClick={chooseFolder}>
            {folder ? "Change output folder…" : "Choose output folder…"}
          </button>
          <span className="field-help">
            {folder ? `Saving to “${fileNameFromPath(folder)}”. Existing files are never overwritten.` : "Outputs are saved next to each other in one folder."}
          </span>
        </div>
      </fieldset>

      <div className="panel">
        <div className="panel-toolbar">
          <span className="panel-count">{items.length === 0 ? "Queue is empty" : `${items.length} ${items.length === 1 ? "file" : "files"}`}</span>
          <div className="toolbar-actions">
            {items.length > 0 && !running && (
              <button type="button" className="button button--ghost" onClick={clear}>
                Clear
              </button>
            )}
            <button type="button" className="button button--secondary" onClick={addItems} disabled={running || engineMissing}>
              <PlusIcon /> Add files
            </button>
          </div>
        </div>
        {notice && (
          <p className="notice" role="status">
            {notice}
          </p>
        )}
        {items.length > 0 && (
          <ol className="file-list" aria-label="Batch queue">
            {items.map((item) => (
              <li key={item.id} className="file-row batch-row">
                <span className={`batch-status batch-status--${item.status}`}>{STATUS_LABEL[item.status]}</span>
                <span className="batch-text">
                  <span className="file-name" title={item.name}>
                    {item.name}
                  </span>
                  {item.detail && <span className="batch-detail">{item.status === "succeeded" ? `→ ${item.detail}` : item.detail}</span>}
                </span>
                {item.status === "queued" && !running && (
                  <button
                    type="button"
                    className="icon-button icon-button--danger"
                    onClick={() => setItems((current) => current.filter((other) => other.id !== item.id))}
                    aria-label={`Remove ${item.name} from the queue`}
                    title="Remove from queue"
                  >
                    <TrashIcon />
                  </button>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>

      {finished && (
        <div className={`status ${summary.failed ? "status--warning" : "status--success"}`} role="status">
          <div className="status-row">
            <span>
              <strong>Batch finished.</strong> {summary.succeeded} done, {summary.failed} failed, {summary.cancelled} cancelled.
            </span>
            {(summary.failed > 0 || summary.cancelled > 0) && (
              <button type="button" className="button button--secondary" onClick={retry}>
                Retry failed and cancelled
              </button>
            )}
          </div>
        </div>
      )}
      {running && (
        <div className="status status--busy" role="status" aria-live="polite">
          <div className="status-row">
            <span>
              Processing {items.length - queued} of {items.length}…
            </span>
            <button type="button" className="button button--secondary" onClick={cancel}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <ActionBar
        hint={
          engineMissing
            ? `${config.engine === "libreOffice" ? "LibreOffice" : "Tesseract"} is required for this operation.`
            : !folder
              ? "Choose an output folder."
              : queued === 0
                ? "Add files to the queue."
                : `${queued} ${queued === 1 ? "file" : "files"} ready.`
        }
      >
        <button type="button" className="button button--primary button--large" onClick={start} disabled={running || !folder || queued === 0 || engineMissing}>
          Start batch
        </button>
      </ActionBar>
    </ToolLayout>
  );
}
