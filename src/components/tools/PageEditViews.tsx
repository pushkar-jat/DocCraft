import { useState } from "react";
import { throwIfCancelled } from "../../lib/errors";
import type { Anchor, Margins } from "../../lib/pageGeometry";
import { rangesToIndices } from "../../lib/pageRanges";
import type { NumberFormat } from "../../lib/pageTools";
import { fileNameFromPath } from "../../lib/paths";
import { chooseSavePath, suggestedPath } from "../../services/output";
import { runPdfWorker } from "../../services/pdfWorkerClient";
import { IMAGE_FILTER, PDF_FILTER, pickFile, readInput, writeOutput } from "../../services/tauriFiles";
import type { PageTool } from "../../workers/pdfWorkerProtocol";
import { useJob, type JobContext } from "../../state/useJob";
import { usePdfSource, type PdfSource } from "../../state/usePdfSource";
import { ALL_PAGES, PageSelectionField, resolveSelection, type PageSelectionValue } from "../PageSelectionField";
import { PdfToolShell } from "./PdfToolShell";

/** Runs a pdf-lib page tool in the worker and saves the result next to the source by default. */
async function runPageTool(context: JobContext, source: PdfSource, params: PageTool, suffix: string, title: string): Promise<string | null> {
  const output = await chooseSavePath(context, {
    title,
    suggested: suggestedPath(source.path, suffix, "pdf"),
    filters: PDF_FILTER,
    inputs: [source.path],
    extension: "pdf",
  });
  if (output === null) return null;
  context.progress("Reading the PDF…");
  const bytes = await readInput(source.path);
  const result = await runPdfWorker(
    { op: "pageTool", input: { name: source.name, bytes }, params },
    { signal: context.signal, onProgress: (p) => context.progress(`Processing page ${p.current} of ${p.total}…`, (p.current / p.total) * 90) },
  );
  throwIfCancelled(context.signal);
  context.progress("Saving…", null, false);
  await writeOutput(output, result.outputs[0]);
  return fileNameFromPath(output);
}

type BackProps = { onBack: () => void };

// ---------------------------------------------------------------- Remove pages

export function RemovePagesView({ onBack }: BackProps) {
  const job = useJob();
  const pdf = usePdfSource(job);
  const [selection, setSelection] = useState<PageSelectionValue>({ mode: "some", text: "" });
  const resolved = pdf.source ? resolveSelection(selection, pdf.source.pageCount) : null;
  const removing = resolved?.ranges ? rangesToIndices(resolved.ranges).length : 0;
  const blocker = !resolved?.valid
    ? (resolved?.error ?? "Enter the pages to remove.")
    : removing >= (pdf.source?.pageCount ?? 0)
      ? "You cannot remove every page."
      : null;

  return (
    <PdfToolShell
      title="Remove pages"
      description="Delete pages you don't need. The original file is never changed."
      onBack={onBack}
      job={job}
      source={pdf.source}
      sourceDetail={pdf.detail}
      onChoose={pdf.choose}
      actionLabel="Remove pages"
      blocker={blocker}
      readyHint={`Will remove ${removing} ${removing === 1 ? "page" : "pages"} and keep ${(pdf.source?.pageCount ?? 0) - removing}.`}
      onRun={() =>
        job.run(async (context) => {
          if (!pdf.source || !resolved?.ranges) return null;
          const saved = await runPageTool(context, pdf.source, { tool: "remove", remove: resolved.ranges }, "_removed", "Save the PDF without those pages as");
          return saved === null ? null : { title: `Saved ${saved} without ${removing} ${removing === 1 ? "page" : "pages"}.` };
        })
      }
    >
      {(source) => <PageSelectionField value={selection} onChange={setSelection} pageCount={source.pageCount} someLabel="Pages to remove" requireRanges />}
    </PdfToolShell>
  );
}

// ---------------------------------------------------------------- Rotate

export function RotateView({ onBack }: BackProps) {
  const job = useJob();
  const pdf = usePdfSource(job);
  const [selection, setSelection] = useState<PageSelectionValue>(ALL_PAGES);
  const [by, setBy] = useState<90 | 180 | 270>(90);
  const resolved = pdf.source ? resolveSelection(selection, pdf.source.pageCount) : null;

  return (
    <PdfToolShell
      title="Rotate PDF"
      description="Turn pages that were scanned or saved sideways or upside down."
      onBack={onBack}
      job={job}
      source={pdf.source}
      sourceDetail={pdf.detail}
      onChoose={pdf.choose}
      actionLabel="Rotate"
      blocker={resolved && !resolved.valid ? (resolved.error ?? "Enter the pages to rotate.") : null}
      onRun={() =>
        job.run(async (context) => {
          if (!pdf.source || !resolved?.valid) return null;
          const saved = await runPageTool(context, pdf.source, { tool: "rotate", selection: resolved.ranges, by }, "_rotated", "Save rotated PDF as");
          return saved === null ? null : { title: `Saved ${saved}.` };
        })
      }
    >
      {(source) => (
        <>
          <div className="choice-row" role="radiogroup" aria-label="Rotation">
            {([[90, "90° clockwise"], [180, "180°"], [270, "90° counter-clockwise"]] as const).map(([value, label]) => (
              <label key={value} className="choice">
                <input type="radio" name="rotate-by" checked={by === value} onChange={() => setBy(value)} />
                {label}
              </label>
            ))}
          </div>
          <PageSelectionField value={selection} onChange={setSelection} pageCount={source.pageCount} />
        </>
      )}
    </PdfToolShell>
  );
}

// ---------------------------------------------------------------- Page numbers

const ANCHORS: [Anchor, string][] = [
  ["bottom-center", "Bottom centre"],
  ["bottom-right", "Bottom right"],
  ["bottom-left", "Bottom left"],
  ["top-center", "Top centre"],
  ["top-right", "Top right"],
  ["top-left", "Top left"],
];

export function PageNumbersView({ onBack }: BackProps) {
  const job = useJob();
  const pdf = usePdfSource(job);
  const [selection, setSelection] = useState<PageSelectionValue>(ALL_PAGES);
  const [anchor, setAnchor] = useState<Anchor>("bottom-center");
  const [format, setFormat] = useState<NumberFormat>("n");
  const [start, setStart] = useState(1);
  const [fontSize, setFontSize] = useState(11);
  const resolved = pdf.source ? resolveSelection(selection, pdf.source.pageCount) : null;

  return (
    <PdfToolShell
      title="Add page numbers"
      description="Number the pages, in the position and style you choose. Numbers stay upright on rotated pages."
      onBack={onBack}
      job={job}
      source={pdf.source}
      sourceDetail={pdf.detail}
      onChoose={pdf.choose}
      actionLabel="Add page numbers"
      blocker={resolved && !resolved.valid ? (resolved.error ?? "Enter the pages to number.") : null}
      onRun={() =>
        job.run(async (context) => {
          if (!pdf.source || !resolved?.valid) return null;
          const saved = await runPageTool(
            context,
            pdf.source,
            { tool: "pageNumbers", settings: { selection: resolved.ranges, anchor, format, start, fontSize, margin: 28 } },
            "_numbered",
            "Save numbered PDF as",
          );
          return saved === null ? null : { title: `Saved ${saved} with page numbers.` };
        })
      }
    >
      {(source) => (
        <>
          <div className="choice-row">
            <label className="inline-field">
              Position
              <select className="select" value={anchor} onChange={(event) => setAnchor(event.target.value as Anchor)}>
                {ANCHORS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="inline-field">
              Style
              <select className="select" value={format} onChange={(event) => setFormat(event.target.value as NumberFormat)}>
                <option value="n">1</option>
                <option value="page-n">Page 1</option>
                <option value="n-of-total">1 / 10</option>
                <option value="page-n-of-total">Page 1 of 10</option>
              </select>
            </label>
            <label className="inline-field">
              First number
              <input className="number-input" type="number" min={0} max={99999} value={start} onChange={(event) => setStart(Math.max(0, Number(event.target.value) || 0))} />
            </label>
            <label className="inline-field">
              Size
              <input className="number-input" type="number" min={6} max={48} value={fontSize} onChange={(event) => setFontSize(Math.min(48, Math.max(6, Number(event.target.value) || 11)))} />
            </label>
          </div>
          <PageSelectionField value={selection} onChange={setSelection} pageCount={source.pageCount} someLabel="Only number these pages" />
        </>
      )}
    </PdfToolShell>
  );
}

// ---------------------------------------------------------------- Watermark

function hexToRgb(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16);
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}

export function WatermarkView({ onBack }: BackProps) {
  const job = useJob();
  const pdf = usePdfSource(job);
  const [selection, setSelection] = useState<PageSelectionValue>(ALL_PAGES);
  const [kind, setKind] = useState<"text" | "image">("text");
  const [text, setText] = useState("CONFIDENTIAL");
  const [color, setColor] = useState("#c62828");
  const [fontSize, setFontSize] = useState(60);
  const [image, setImage] = useState<{ path: string; name: string } | null>(null);
  const [scale, setScale] = useState(40);
  const [opacity, setOpacity] = useState(25);
  const [angle, setAngle] = useState(45);
  const [layout, setLayout] = useState<"center" | "tile">("center");
  const resolved = pdf.source ? resolveSelection(selection, pdf.source.pageCount) : null;
  const blocker =
    resolved && !resolved.valid
      ? (resolved.error ?? "Enter the pages to watermark.")
      : kind === "text" && text.trim() === ""
        ? "Enter the watermark text."
        : kind === "image" && !image
          ? "Choose a watermark image."
          : null;

  const chooseImage = () =>
    job.run(async (context) => {
      context.progress("Choose an image in the dialog.", null, false);
      const path = await pickFile("Select a watermark image", IMAGE_FILTER);
      if (path) setImage({ path, name: fileNameFromPath(path) });
      return null;
    });

  return (
    <PdfToolShell
      title="Add watermark"
      description="Stamp text or an image over your pages, such as DRAFT, CONFIDENTIAL or a logo."
      onBack={onBack}
      job={job}
      source={pdf.source}
      sourceDetail={pdf.detail}
      onChoose={pdf.choose}
      actionLabel="Add watermark"
      blocker={blocker}
      onRun={() =>
        job.run(async (context) => {
          if (!pdf.source || !resolved?.valid) return null;
          const content =
            kind === "text"
              ? ({ kind: "text", text: text.trim(), fontSize, color: hexToRgb(color) } as const)
              : ({ kind: "image", bytes: await readInput(image!.path, 50 * 1024 * 1024), name: image!.name, scale: scale / 100 } as const);
          const saved = await runPageTool(
            context,
            pdf.source,
            { tool: "watermark", settings: { selection: resolved.ranges, content, opacity: opacity / 100, angle, layout } },
            "_watermarked",
            "Save watermarked PDF as",
          );
          return saved === null ? null : { title: `Saved ${saved} with a watermark.` };
        })
      }
    >
      {(source) => (
        <>
          <div className="choice-row">
            <label className="choice">
              <input type="radio" name="wm-kind" checked={kind === "text"} onChange={() => setKind("text")} /> Text
            </label>
            <label className="choice">
              <input type="radio" name="wm-kind" checked={kind === "image"} onChange={() => setKind("image")} /> Image (JPEG/PNG)
            </label>
          </div>
          {kind === "text" ? (
            <div className="choice-row">
              <label className="inline-field">
                Text
                <input className="text-input" style={{ width: "16em" }} value={text} maxLength={80} onChange={(event) => setText(event.target.value)} />
              </label>
              <label className="inline-field">
                Colour
                <input type="color" value={color} onChange={(event) => setColor(event.target.value)} aria-label="Watermark colour" />
              </label>
              <label className="inline-field">
                Size
                <input className="number-input" type="number" min={8} max={200} value={fontSize} onChange={(event) => setFontSize(Math.min(200, Math.max(8, Number(event.target.value) || 60)))} />
              </label>
            </div>
          ) : (
            <div className="choice-row">
              <button type="button" className="button button--secondary" onClick={chooseImage}>
                {image ? "Change image…" : "Choose image…"}
              </button>
              <span className="field-help">{image?.name ?? "No image chosen"}</span>
              <label className="inline-field">
                Size
                <input type="range" min={5} max={100} value={scale} onChange={(event) => setScale(Number(event.target.value))} aria-label="Image size, percent of page" />
                {scale}%
              </label>
            </div>
          )}
          <div className="choice-row">
            <label className="inline-field">
              Opacity
              <input type="range" min={5} max={100} value={opacity} onChange={(event) => setOpacity(Number(event.target.value))} aria-label="Opacity, percent" />
              {opacity}%
            </label>
            <label className="inline-field">
              Angle
              <select className="select" value={angle} onChange={(event) => setAngle(Number(event.target.value))}>
                <option value={0}>Horizontal</option>
                <option value={45}>Diagonal ↗</option>
                <option value={-45}>Diagonal ↘</option>
                <option value={90}>Vertical</option>
              </select>
            </label>
            <label className="inline-field">
              Layout
              <select className="select" value={layout} onChange={(event) => setLayout(event.target.value as "center" | "tile")}>
                <option value="center">Once, centred</option>
                <option value="tile">Repeated across the page</option>
              </select>
            </label>
          </div>
          <PageSelectionField value={selection} onChange={setSelection} pageCount={source.pageCount} />
        </>
      )}
    </PdfToolShell>
  );
}

// ---------------------------------------------------------------- Crop

const MM = 72 / 25.4;

export function CropView({ onBack }: BackProps) {
  const job = useJob();
  const pdf = usePdfSource(job);
  const [selection, setSelection] = useState<PageSelectionValue>(ALL_PAGES);
  const [margins, setMargins] = useState<Margins>({ top: 10, right: 10, bottom: 10, left: 10 });
  const resolved = pdf.source ? resolveSelection(selection, pdf.source.pageCount) : null;
  const allZero = Object.values(margins).every((value) => value === 0);

  return (
    <PdfToolShell
      title="Crop PDF"
      description="Trim the edges of pages, for example scanner borders or wide margins. Measured in millimetres, as you see the page."
      onBack={onBack}
      job={job}
      source={pdf.source}
      sourceDetail={pdf.detail}
      onChoose={pdf.choose}
      actionLabel="Crop"
      blocker={resolved && !resolved.valid ? (resolved.error ?? "Enter the pages to crop.") : allZero ? "Set at least one margin above 0 mm." : null}
      onRun={() =>
        job.run(async (context) => {
          if (!pdf.source || !resolved?.valid) return null;
          const points = { top: margins.top * MM, right: margins.right * MM, bottom: margins.bottom * MM, left: margins.left * MM };
          const saved = await runPageTool(context, pdf.source, { tool: "crop", selection: resolved.ranges, margins: points }, "_cropped", "Save cropped PDF as");
          return saved === null ? null : { title: `Saved ${saved}.`, details: ["Cropping hides the trimmed area; it can be restored with a PDF editor that resets the crop box."] };
        })
      }
    >
      {(source) => (
        <>
          <div className="choice-row">
            {(["top", "right", "bottom", "left"] as const).map((side) => (
              <label key={side} className="inline-field">
                {side[0].toUpperCase() + side.slice(1)}
                <input
                  className="number-input"
                  type="number"
                  min={0}
                  max={200}
                  value={margins[side]}
                  onChange={(event) => setMargins((current) => ({ ...current, [side]: Math.min(200, Math.max(0, Number(event.target.value) || 0)) }))}
                />
                mm
              </label>
            ))}
          </div>
          <PageSelectionField value={selection} onChange={setSelection} pageCount={source.pageCount} />
        </>
      )}
    </PdfToolShell>
  );
}
