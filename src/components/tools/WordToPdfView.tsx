import { useState } from "react";
import { throwIfCancelled } from "../../lib/errors";
import { extensionOf } from "../../lib/naming";
import { fileNameFromPath } from "../../lib/paths";
import { convertDocument } from "../../services/operations";
import { chooseSavePath, suggestedPath } from "../../services/output";
import { pickFile, PDF_FILTER, readInput, writeOutput, type FileFilter } from "../../services/tauriFiles";
import { useEngines } from "../../state/EnginesContext";
import { useJob } from "../../state/useJob";
import { usePdfSource } from "../../state/usePdfSource";
import { EngineNotice } from "../EngineNotice";
import { JobStatus } from "../JobStatus";
import { ActionBar, SingleFilePicker, ToolLayout } from "../ToolLayout";
import { PdfToolShell } from "./PdfToolShell";

export type OfficeKind = "word" | "powerpoint" | "excel" | "html";

const KINDS: Record<OfficeKind, { title: string; description: string; noun: string; filter: FileFilter[]; note: string }> = {
  word: {
    title: "Word to PDF",
    description: "Convert DOCX, DOC, ODT or RTF documents to PDF with LibreOffice on this computer. Nothing is uploaded.",
    noun: "document",
    filter: [{ name: "Word documents", extensions: ["docx", "doc", "odt", "rtf"] }],
    note: "Check the layout: fonts not installed on this computer are substituted.",
  },
  powerpoint: {
    title: "PowerPoint to PDF",
    description: "Convert PPTX, PPT or ODP presentations to PDF, one slide per page, with LibreOffice on this computer.",
    noun: "presentation",
    filter: [{ name: "Presentations", extensions: ["pptx", "ppt", "odp"] }],
    note: "Animations and embedded videos cannot appear in a PDF; each slide is shown as it looks when the slideshow ends.",
  },
  excel: {
    title: "Excel to PDF",
    description: "Convert XLSX, XLS or ODS spreadsheets to PDF with LibreOffice on this computer.",
    noun: "spreadsheet",
    filter: [{ name: "Spreadsheets", extensions: ["xlsx", "xls", "ods"] }],
    note: "Every sheet is included, using each sheet's print area and page setup. Wide sheets may span several pages.",
  },
  html: {
    title: "HTML to PDF",
    description: "Convert a saved web page or HTML file on this computer to PDF. Web addresses are never fetched.",
    noun: "HTML file",
    filter: [{ name: "HTML files", extensions: ["html", "htm"] }],
    note: "Pictures and styles that live on the internet are left out so nothing is downloaded; pictures embedded in the file are kept.",
  },
};

export function WordToPdfView({ onBack, kind = "word" }: { onBack: () => void; kind?: OfficeKind }) {
  const config = KINDS[kind];
  const job = useJob();
  const { status } = useEngines();
  const ready = status?.libreOffice.available ?? false;
  const [source, setSource] = useState<{ path: string; name: string } | null>(null);

  const choose = () =>
    job.run(async (context) => {
      context.progress(`Choose a ${config.noun} in the dialog.`, null, false);
      const path = await pickFile(`Select a ${config.noun}`, config.filter);
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
      context.progress(`Reading the ${config.noun}…`);
      const input = await readInput(source.path);
      // LibreOffice cannot report progress, so this stays indeterminate.
      context.progress("Converting with LibreOffice… The first conversion can take up to a minute.");
      const pdf = await convertDocument(input, extensionOf(source.name), "to-pdf", { signal: context.signal });
      throwIfCancelled(context.signal);
      context.progress("Saving…", null, false);
      await writeOutput(output, pdf);
      return { title: `Converted to ${fileNameFromPath(output)}.`, details: [config.note] };
    });

  return (
    <ToolLayout title={config.title} description={config.description} onBack={onBack} busy={job.busy}>
      <EngineNotice engine="libreOffice" />
      <SingleFilePicker label={`Select a ${config.noun}`} fileName={source?.name ?? null} onChoose={choose} disabled={job.busy} />
      <JobStatus job={job} />
      <ActionBar hint={!ready ? "LibreOffice is required for this tool." : source ? "Ready." : `Choose a ${config.noun} to start.`}>
        <button type="button" className="button button--primary button--large" onClick={convert} disabled={job.busy || !source || !ready}>
          Convert to PDF
        </button>
      </ActionBar>
    </ToolLayout>
  );
}

/** PDF -> PowerPoint or PDF -> PDF/A through LibreOffice. */
export function PdfLibreOfficeView({ onBack, target }: { onBack: () => void; target: "pptx" | "pdfa" }) {
  const job = useJob();
  const pdf = usePdfSource(job);
  const { status } = useEngines();
  const ready = status?.libreOffice.available ?? false;
  const pptx = target === "pptx";

  return (
    <PdfToolShell
      title={pptx ? "PDF to PowerPoint" : "PDF to PDF/A"}
      description={
        pptx
          ? "Turn each page into a slide with editable text boxes, using LibreOffice on this computer."
          : "Make an archival PDF/A-2b copy for long-term storage, using LibreOffice on this computer."
      }
      onBack={onBack}
      job={job}
      source={pdf.source}
      sourceDetail={pdf.detail}
      onChoose={pdf.choose}
      actionLabel={pptx ? "Convert to PowerPoint" : "Convert to PDF/A"}
      blocker={ready ? null : "LibreOffice is required for this tool."}
      notice={
        <>
          <EngineNotice engine="libreOffice" />
          <div className="status status--info">
            {pptx ? (
              <>
                <strong>Layout is approximate.</strong> Text becomes separate boxes on each slide and fonts may be substituted. Scanned pages become pictures.
              </>
            ) : (
              <>
                <strong>The PDF is rebuilt.</strong> PDF/A embeds fonts and removes features archives cannot keep (such as scripts). Check the copy before deleting the original; forms
                and digital signatures do not carry over.
              </>
            )}
          </div>
        </>
      }
      onRun={() =>
        job.run(async (context) => {
          const source = pdf.source;
          if (!source) return null;
          const extension = pptx ? "pptx" : "pdf";
          const output = await chooseSavePath(context, {
            title: pptx ? "Save PowerPoint as" : "Save PDF/A as",
            suggested: suggestedPath(source.path, pptx ? "" : "_PDFA", extension),
            filters: pptx ? [{ name: "PowerPoint presentation", extensions: ["pptx"] }] : PDF_FILTER,
            inputs: [source.path],
            extension,
          });
          if (output === null) return null;
          const input = await readInput(source.path);
          context.progress("Converting with LibreOffice… Large documents can take a few minutes.");
          const result = await convertDocument(input, "pdf", pptx ? "pdf-to-pptx" : "pdf-to-pdfa", { signal: context.signal });
          throwIfCancelled(context.signal);
          context.progress("Saving…", null, false);
          await writeOutput(output, result);
          return {
            title: `Saved ${fileNameFromPath(output)}.`,
            details: pptx ? ["Review the slides: positions and fonts are approximate."] : ["Declares PDF/A-2b conformance. For formal compliance checks, validate it with a tool such as veraPDF."],
          };
        })
      }
    />
  );
}
