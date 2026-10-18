import { useState } from "react";
import { DocError, throwIfCancelled } from "../../lib/errors";
import { baseName } from "../../lib/naming";
import { rangesToIndices } from "../../lib/pageRanges";
import { fileNameFromPath, pathKey } from "../../lib/paths";
import { pdfToMarkdown } from "../../services/operations";
import { chooseSavePath, suggestedPath } from "../../services/output";
import { openPdfRenderer, type ImageFormat } from "../../services/pdfjs";
import { freeOutputPath, pickFolder, readInput, writeOutput } from "../../services/tauriFiles";
import { useJob } from "../../state/useJob";
import { usePdfSource } from "../../state/usePdfSource";
import { ALL_PAGES, PageSelectionField, resolveSelection, type PageSelectionValue } from "../PageSelectionField";
import { PdfToolShell } from "./PdfToolShell";

type BackProps = { onBack: () => void };

// ---------------------------------------------------------------- PDF to JPG / PNG

export function PdfToImagesView({ onBack }: BackProps) {
  const job = useJob();
  const pdf = usePdfSource(job);
  const [format, setFormat] = useState<ImageFormat>("jpeg");
  const [dpi, setDpi] = useState(150);
  const [selection, setSelection] = useState<PageSelectionValue>(ALL_PAGES);
  const resolved = pdf.source ? resolveSelection(selection, pdf.source.pageCount) : null;

  return (
    <PdfToolShell
      title="PDF to JPG"
      description="Save each page as an image (JPG or PNG), rendered on this computer."
      onBack={onBack}
      job={job}
      source={pdf.source}
      sourceDetail={pdf.detail}
      onChoose={pdf.choose}
      actionLabel="Convert to images"
      blocker={resolved && !resolved.valid ? (resolved.error ?? "Enter the pages to convert.") : null}
      readyHint="Ready. You will choose a folder for the images next."
      onRun={() =>
        job.run(async (context) => {
          const source = pdf.source;
          if (!source || !resolved?.valid) return null;
          context.progress("Choose a folder for the images in the dialog.", null, false);
          const folder = await pickFolder("Choose a folder for the page images");
          if (folder === null) return null;
          const pages = resolved.ranges ? rangesToIndices(resolved.ranges).map((index) => index + 1) : [...Array(source.pageCount).keys()].map((index) => index + 1);
          const renderer = await openPdfRenderer(await readInput(source.path), source.name);
          const extension = format === "png" ? "png" : "jpg";
          const width = String(source.pageCount).length;
          const reserved = new Set<string>();
          const written: string[] = [];
          try {
            for (const [index, pageNumber] of pages.entries()) {
              throwIfCancelled(context.signal);
              context.progress(`Rendering page ${pageNumber} (${index + 1} of ${pages.length})…`, (index / pages.length) * 100);
              const { image } = await renderer.render(pageNumber, { dpi, format, quality: 0.92 });
              const path = await freeOutputPath(folder, `${baseName(source.name)}_page_${String(pageNumber).padStart(width, "0")}`, extension, reserved);
              reserved.add(pathKey(path));
              await writeOutput(path, image);
              written.push(fileNameFromPath(path));
            }
          } finally {
            await renderer.close();
          }
          return {
            title: `Saved ${written.length} ${written.length === 1 ? "image" : "images"} in “${fileNameFromPath(folder)}”.`,
            details: written.length <= 6 ? written : [...written.slice(0, 6), `…and ${written.length - 6} more`],
          };
        })
      }
    >
      {(source) => (
        <>
          <div className="choice-row">
            <label className="inline-field">
              Format
              <select className="select" value={format} onChange={(event) => setFormat(event.target.value as ImageFormat)}>
                <option value="jpeg">JPG (smaller files)</option>
                <option value="png">PNG (lossless)</option>
              </select>
            </label>
            <label className="inline-field">
              Quality
              <select className="select" value={dpi} onChange={(event) => setDpi(Number(event.target.value))}>
                <option value={72}>Screen (72 dpi)</option>
                <option value={150}>Normal (150 dpi)</option>
                <option value={300}>High (300 dpi)</option>
              </select>
            </label>
          </div>
          <PageSelectionField value={selection} onChange={setSelection} pageCount={source.pageCount} />
        </>
      )}
    </PdfToolShell>
  );
}

// ---------------------------------------------------------------- PDF to Markdown

export function PdfToMarkdownView({ onBack }: BackProps) {
  const job = useJob();
  const pdf = usePdfSource(job);
  return (
    <PdfToolShell
      title="PDF to Markdown"
      description="Turn the text of a PDF into Markdown: headings, paragraphs and lists. No AI involved — it runs entirely on this computer."
      onBack={onBack}
      job={job}
      source={pdf.source}
      sourceDetail={pdf.detail}
      onChoose={pdf.choose}
      actionLabel="Convert to Markdown"
      blocker={null}
      notice={
        <div className="status status--info">
          <strong>Basic layout.</strong> Tables, images and multi-column layouts are not reproduced. Scanned PDFs need OCR first.
        </div>
      }
      onRun={() =>
        job.run(async (context) => {
          const source = pdf.source;
          if (!source) return null;
          const output = await chooseSavePath(context, {
            title: "Save Markdown as",
            suggested: suggestedPath(source.path, "", "md"),
            filters: [{ name: "Markdown", extensions: ["md"] }],
            inputs: [source.path],
            extension: "md",
          });
          if (output === null) return null;
          const result = await pdfToMarkdown(await readInput(source.path), source.name, {
            signal: context.signal,
            onProgress: (p) => context.progress(`Reading page ${p.current} of ${p.total}…`, (p.current / p.total) * 95),
          });
          throwIfCancelled(context.signal);
          if (result.markdown.trim() === "") throw new DocError("no-text", "No text could be extracted from this PDF.");
          context.progress("Saving…", null, false);
          await writeOutput(output, new TextEncoder().encode(result.markdown));
          return {
            title: `Saved ${fileNameFromPath(output)}.`,
            details: [`${result.pageCount} ${result.pageCount === 1 ? "page" : "pages"}, ${result.characterCount.toLocaleString()} characters.`],
          };
        })
      }
    />
  );
}
