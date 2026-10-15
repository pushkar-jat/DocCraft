import { useState } from "react";
import { formatBytes, percentChange } from "../../lib/naming";
import { fileNameFromPath } from "../../lib/paths";
import { compressPdf, type CompressPreset } from "../../services/operations";
import { chooseSavePath, suggestedPath } from "../../services/output";
import { pickFile, PDF_FILTER, readInput, writeOutput } from "../../services/tauriFiles";
import { useJob } from "../../state/useJob";
import { JobStatus } from "../JobStatus";
import { ActionBar, SingleFilePicker, ToolLayout } from "../ToolLayout";

const PRESETS: { id: CompressPreset; title: string; description: string }[] = [
  {
    id: "high",
    title: "Higher quality (lossless)",
    description: "Removes unused data and recompresses document structure. Images are not touched, so quality is unchanged.",
  },
  {
    id: "balanced",
    title: "Balanced",
    description: "Lossless steps, plus JPEG photos re-encoded at quality 75 and images larger than 2500 px downscaled.",
  },
  {
    id: "small",
    title: "Smaller file",
    description: "Lossless steps, plus all eligible images converted to JPEG at quality 55 and downscaled to 1600 px. Images may look softer.",
  },
];

interface Result {
  bytes: Uint8Array;
  before: number;
  after: number;
  preset: CompressPreset;
}

export function CompressView({ onBack }: { onBack: () => void }) {
  const job = useJob();
  const [source, setSource] = useState<{ path: string; name: string; size: number } | null>(null);
  const [preset, setPreset] = useState<CompressPreset>("balanced");
  const [result, setResult] = useState<Result | null>(null);

  const choose = () =>
    job.run(async (context) => {
      context.progress("Choose a PDF in the dialog.", null, false);
      const path = await pickFile("Select a PDF to compress", PDF_FILTER);
      if (path === null) return null;
      const bytes = await readInput(path);
      setSource({ path, name: fileNameFromPath(path), size: bytes.length });
      setResult(null);
      return null;
    });

  const compress = () =>
    job.run(async (context) => {
      if (!source) return null;
      setResult(null);
      context.progress("Reading the PDF…");
      const input = await readInput(source.path);
      context.progress("Optimizing…");
      const output = await compressPdf(input, preset, {
        signal: context.signal,
        onProgress: (p) => context.progress(`Optimizing image ${p.current} of ${p.total}…`, (p.current / p.total) * 90),
      });
      const change = percentChange(input.length, output.length);
      if (output.length >= input.length) {
        return {
          title: "This PDF could not be made smaller with this setting.",
          details: [`Original: ${formatBytes(input.length)}`, `Optimized version would be: ${formatBytes(output.length)} (+${change}%)`],
          warning: "Nothing to save. The PDF may already be optimized; try “Smaller file” if it contains photos.",
          tone: "info",
        };
      }
      setResult({ bytes: output, before: input.length, after: output.length, preset });
      return null;
    });

  const save = () =>
    job.run(async (context) => {
      if (!source || !result) return null;
      const output = await chooseSavePath(context, {
        title: "Save compressed PDF as",
        suggested: suggestedPath(source.path, "_compressed", "pdf"),
        filters: PDF_FILTER,
        inputs: [source.path],
        extension: "pdf",
      });
      if (output === null) return null;
      context.progress("Saving…", null, false);
      await writeOutput(output, result.bytes);
      setResult(null);
      return {
        title: `Saved ${fileNameFromPath(output)}.`,
        details: [`${formatBytes(result.before)} → ${formatBytes(result.after)} (${percentChange(result.before, result.after)}%)`],
      };
    });

  return (
    <ToolLayout
      title="Compress PDF"
      description="Optimize a PDF on this computer. Results vary: some PDFs are already compact and cannot shrink."
      onBack={onBack}
      busy={job.busy}
    >
      <SingleFilePicker label="Select a PDF" fileName={source?.name ?? null} detail={source ? formatBytes(source.size) : null} onChoose={choose} disabled={job.busy} />

      <fieldset className="panel form-panel" disabled={job.busy}>
        <legend className="form-legend">Compression level</legend>
        <div className="option-list">
          {PRESETS.map((option) => (
            <label key={option.id} className={`option-card ${preset === option.id ? "option-card--selected" : ""}`}>
              <input type="radio" name="preset" checked={preset === option.id} onChange={() => {
                  setPreset(option.id);
                  setResult(null);
                }} />
              <span>
                <span className="option-title">{option.title}</span>
                <span className="option-description">{option.description}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {result && (
        <div className="status status--success" role="status">
          <div className="status-row">
            <div>
              <strong>
                Reduced by {Math.abs(percentChange(result.before, result.after))}%: {formatBytes(result.before)} → {formatBytes(result.after)}
              </strong>
              <p className="status-text">Not saved yet. Choose where to save the compressed copy; the original stays unchanged.</p>
            </div>
            <button type="button" className="button button--primary" onClick={save} disabled={job.busy}>
              Save…
            </button>
          </div>
        </div>
      )}

      <JobStatus job={job} />

      <ActionBar hint={source ? "Compression happens before saving, so you can see the result first." : "Choose a PDF to start."}>
        <button type="button" className="button button--primary button--large" onClick={compress} disabled={job.busy || !source}>
          Compress
        </button>
      </ActionBar>
    </ToolLayout>
  );
}
