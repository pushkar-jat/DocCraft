import { useState } from "react";
import { throwIfCancelled } from "../../lib/errors";
import { fileNameFromPath } from "../../lib/paths";
import { pdfToWord } from "../../services/operations";
import { chooseSavePath, suggestedPath } from "../../services/output";
import { DOCX_FILTER, pickFile, PDF_FILTER, readInput, writeOutput } from "../../services/tauriFiles";
import { useJob } from "../../state/useJob";
import { JobStatus } from "../JobStatus";
import { ActionBar, SingleFilePicker, ToolLayout } from "../ToolLayout";

export function PdfToWordView({ onBack }: { onBack: () => void }) {
  const job = useJob();
  const [source, setSource] = useState<{ path: string; name: string } | null>(null);

  const choose = () =>
    job.run(async (context) => {
      context.progress("Choose a PDF in the dialog.", null, false);
      const path = await pickFile("Select a PDF", PDF_FILTER);
      if (path !== null) setSource({ path, name: fileNameFromPath(path) });
      return null;
    });

  const convert = () =>
    job.run(async (context) => {
      if (!source) return null;
      const output = await chooseSavePath(context, {
        title: "Save Word document as",
        suggested: suggestedPath(source.path, "", "docx"),
        filters: DOCX_FILTER,
        inputs: [source.path],
        extension: "docx",
      });
      if (output === null) return null;
      context.progress("Reading the PDF…");
      const input = await readInput(source.path);
      const result = await pdfToWord(input, source.name, {
        signal: context.signal,
        onProgress: (p) => context.progress(`Extracting text from page ${p.current} of ${p.total}…`, (p.current / p.total) * 95),
      });
      throwIfCancelled(context.signal);
      context.progress("Saving…", null, false);
      await writeOutput(output, result.bytes);
      return {
        title: `Created ${fileNameFromPath(output)} (basic layout).`,
        details: [`${result.pageCount} ${result.pageCount === 1 ? "page" : "pages"}, ${result.characterCount.toLocaleString()} characters of text.`],
        warning: "Review the document: images, tables, columns and exact formatting are not reproduced.",
      };
    });

  return (
    <ToolLayout
      title="PDF to Word"
      description="Turn the text of a PDF into an editable DOCX on this computer."
      onBack={onBack}
      busy={job.busy}
    >
      <div className="status status--info">
        <strong>Basic layout.</strong>{" "}
        DocCraft keeps the text, paragraphs, larger headings and page breaks. Images, tables, columns, fonts and exact positioning are not
        reproduced. Scanned PDFs have no text to extract: run OCR on them first.
      </div>
      <SingleFilePicker label="Select a PDF" fileName={source?.name ?? null} onChoose={choose} disabled={job.busy} />
      <JobStatus job={job} />
      <ActionBar hint={source ? "Ready." : "Choose a PDF to start."}>
        <button type="button" className="button button--primary button--large" onClick={convert} disabled={job.busy || !source}>
          Convert to Word
        </button>
      </ActionBar>
    </ToolLayout>
  );
}
