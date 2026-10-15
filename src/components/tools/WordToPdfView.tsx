import { useState } from "react";
import { throwIfCancelled } from "../../lib/errors";
import { extensionOf } from "../../lib/naming";
import { fileNameFromPath } from "../../lib/paths";
import { wordToPdf } from "../../services/operations";
import { chooseSavePath, suggestedPath } from "../../services/output";
import { pickFile, PDF_FILTER, readInput, WORD_FILTER, writeOutput } from "../../services/tauriFiles";
import { useEngines } from "../../state/EnginesContext";
import { useJob } from "../../state/useJob";
import { EngineNotice } from "../EngineNotice";
import { JobStatus } from "../JobStatus";
import { ActionBar, SingleFilePicker, ToolLayout } from "../ToolLayout";

export function WordToPdfView({ onBack }: { onBack: () => void }) {
  const job = useJob();
  const { status } = useEngines();
  const ready = status?.libreOffice.available ?? false;
  const [source, setSource] = useState<{ path: string; name: string } | null>(null);

  const choose = () =>
    job.run(async (context) => {
      context.progress("Choose a document in the dialog.", null, false);
      const path = await pickFile("Select a Word document", WORD_FILTER);
      if (path !== null) setSource({ path, name: fileNameFromPath(path) });
      return null;
    });

  const convert = () =>
    job.run(async (context) => {
      if (!source) return null;
      const output = await chooseSavePath(context, {
        title: "Save PDF as",
        suggested: suggestedPath(source.path, "", "pdf"),
        filters: PDF_FILTER,
        inputs: [source.path],
        extension: "pdf",
      });
      if (output === null) return null;
      context.progress("Reading the document…");
      const input = await readInput(source.path);
      // LibreOffice cannot report progress, so this stays indeterminate.
      context.progress("Converting with LibreOffice… The first conversion can take up to a minute.");
      const pdf = await wordToPdf(input, extensionOf(source.name), { signal: context.signal });
      throwIfCancelled(context.signal);
      context.progress("Saving…", null, false);
      await writeOutput(output, pdf);
      return { title: `Converted to ${fileNameFromPath(output)}.`, details: ["Check the layout: fonts not installed on this computer are substituted."] };
    });

  return (
    <ToolLayout
      title="Word to PDF"
      description="Convert DOCX, DOC, ODT or RTF documents to PDF with LibreOffice on this computer. Nothing is uploaded."
      onBack={onBack}
      busy={job.busy}
    >
      <EngineNotice engine="libreOffice" />
      <SingleFilePicker label="Select a document" fileName={source?.name ?? null} onChoose={choose} disabled={job.busy} />
      <JobStatus job={job} />
      <ActionBar hint={!ready ? "LibreOffice is required for this tool." : source ? "Ready." : "Choose a document to start."}>
        <button type="button" className="button button--primary button--large" onClick={convert} disabled={job.busy || !source || !ready}>
          Convert to PDF
        </button>
      </ActionBar>
    </ToolLayout>
  );
}
