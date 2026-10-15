import { useEffect, useState } from "react";
import { DocError, throwIfCancelled } from "../../lib/errors";
import { describeOcrProgress } from "../../lib/ocrPipeline";
import { fileNameFromPath } from "../../lib/paths";
import { addFiles, hasExtension, moveFile, removeFile, type SelectedFile } from "../../lib/selection";
import { countTextCharacters, ocrImageFiles, ocrPdfFile } from "../../services/operations";
import { chooseSavePath, suggestedPath } from "../../services/output";
import { IMAGE_FILTER, PDF_FILTER, pickFiles, readInput, writeOutput } from "../../services/tauriFiles";
import { useEngines } from "../../state/EnginesContext";
import { useJob } from "../../state/useJob";
import { EngineNotice } from "../EngineNotice";
import { FileList } from "../FileList";
import { PlusIcon } from "../Icons";
import { JobStatus } from "../JobStatus";
import { ActionBar, ToolLayout } from "../ToolLayout";

type Source = "pdf" | "images";

export function OcrView({ onBack }: { onBack: () => void }) {
  const job = useJob();
  const { status } = useEngines();
  const tesseract = status?.tesseract;
  const ready = tesseract?.available ?? false;
  const languages = tesseract?.languages ?? [];
  const [language, setLanguage] = useState("eng");
  const [source, setSource] = useState<Source>("pdf");
  const [files, setFiles] = useState<SelectedFile[]>([]);

  useEffect(() => {
    if (languages.length > 0 && !languages.includes(language)) setLanguage(languages.includes("eng") ? "eng" : languages[0]);
  }, [languages, language]);

  const switchSource = (next: Source) => {
    setSource(next);
    setFiles([]);
  };

  const add = () =>
    job.run(async (context) => {
      context.progress("Choose files in the dialog.", null, false);
      if (source === "pdf") {
        const [path] = await pickFiles("Select a scanned PDF", PDF_FILTER);
        if (path) setFiles(addFiles([], [path]).files);
      } else {
        const paths = await pickFiles("Select scanned images", IMAGE_FILTER);
        setFiles((current) => addFiles(current, paths, hasExtension(["jpg", "jpeg", "png"])).files);
      }
      return null;
    });

  const run = () =>
    job.run(async (context) => {
      if (files.length === 0) return null;
      const first = files[0];
      const output = await chooseSavePath(context, {
        title: "Save searchable PDF as",
        suggested: suggestedPath(first.path, "_searchable", "pdf"),
        filters: PDF_FILTER,
        inputs: files.map((file) => file.path),
        extension: "pdf",
      });
      if (output === null) return null;

      const onProgress = (p: Parameters<typeof describeOcrProgress>[0]) => {
        const done = p.stage === "assembling" ? p.total : p.current - (p.stage === "rendering" ? 1 : 0.5);
        context.progress(describeOcrProgress(p), (done / p.total) * 95);
      };
      let pdf: Uint8Array;
      if (source === "pdf") {
        const bytes = await readInput(first.path);
        pdf = await ocrPdfFile(bytes, first.name, [language], { signal: context.signal, onProgress });
      } else {
        const images = [];
        for (const file of files) images.push({ name: file.name, bytes: await readInput(file.path) });
        pdf = await ocrImageFiles(images, [language], { signal: context.signal, onProgress });
      }
      throwIfCancelled(context.signal);
      context.progress("Checking the recognized text…", 97);
      const characters = await countTextCharacters(pdf, fileNameFromPath(output)).catch(() => {
        throw new DocError("conversion-failed", "The OCR result could not be read back. No file was saved.");
      });
      context.progress("Saving…", null, false);
      await writeOutput(output, pdf);
      return {
        title: `Saved searchable PDF ${fileNameFromPath(output)}.`,
        details: [`Recognized ${characters.toLocaleString()} characters of text (language: ${language}).`],
        warning:
          characters === 0
            ? "No text was recognized. Check that the pages contain readable text and that the right language is selected."
            : "OCR is not perfect: check important numbers and names against the original.",
      };
    });

  return (
    <ToolLayout
      title="OCR / searchable PDF"
      description="Recognize text in scanned PDFs or images with Tesseract on this computer and save a searchable PDF."
      onBack={onBack}
      busy={job.busy}
    >
      <EngineNotice engine="tesseract" />
      <fieldset className="panel form-panel" disabled={job.busy}>
        <legend className="form-legend">Input</legend>
        <div className="choice-row">
          <label className="choice">
            <input type="radio" name="ocr-source" checked={source === "pdf"} onChange={() => switchSource("pdf")} />
            A scanned PDF
          </label>
          <label className="choice">
            <input type="radio" name="ocr-source" checked={source === "images"} onChange={() => switchSource("images")} />
            Images (JPEG/PNG), one page each
          </label>
          <label className="inline-field">
            Language
            <select className="select" value={language} onChange={(event) => setLanguage(event.target.value)} disabled={!ready}>
              {(languages.length ? languages : ["eng"]).map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="field-help">
          Each page is rendered at 300 dpi and recognized locally. The output pages are images with an invisible text layer, so they look like
          the scan but can be searched and copied. Existing text layers are replaced.
        </p>
      </fieldset>

      <div className="panel">
        <div className="panel-toolbar">
          <span className="panel-count">{files.length === 0 ? "Nothing selected" : `${files.length} ${files.length === 1 ? "file" : "files"}`}</span>
          <button type="button" className="button button--secondary" onClick={add} disabled={job.busy}>
            <PlusIcon /> {source === "pdf" ? (files.length ? "Choose another PDF" : "Select PDF") : "Add images"}
          </button>
        </div>
        {files.length > 0 && (
          <FileList
            files={files}
            disabled={job.busy || source === "pdf"}
            onMove={(id, offset) => setFiles((current) => moveFile(current, id, offset))}
            onRemove={(id) => setFiles((current) => removeFile(current, id))}
          />
        )}
      </div>

      <JobStatus job={job} />
      <ActionBar hint={!ready ? "Tesseract OCR is required for this tool." : files.length ? "Ready. OCR takes a few seconds per page." : "Select a scanned PDF or images."}>
        <button type="button" className="button button--primary button--large" onClick={run} disabled={job.busy || !ready || files.length === 0}>
          Make searchable PDF
        </button>
      </ActionBar>
    </ToolLayout>
  );
}
