import { useCallback, useState } from "react";
import { formatBytes } from "../lib/naming";
import { fileNameFromPath } from "../lib/paths";
import { runPdfWorker } from "../services/pdfWorkerClient";
import { pickFile, PDF_FILTER, readInput } from "../services/tauriFiles";
import type { Job } from "./useJob";

export interface PdfSource {
  path: string;
  name: string;
  pageCount: number;
  size: number;
}

/**
 * Picks a PDF with the native dialog and reads its page count (validating it on the way).
 * With `countPages: false` the file is not opened, for inputs that are encrypted or damaged
 * (pageCount is then 0).
 */
export function usePdfSource(job: Job, title = "Select a PDF", { countPages = true }: { countPages?: boolean } = {}) {
  const [source, setSource] = useState<PdfSource | null>(null);

  const choose = useCallback(
    () =>
      job.run(async (context) => {
        context.progress("Choose a PDF in the dialog.", null, false);
        const path = await pickFile(title, PDF_FILTER);
        if (path === null) return null;
        context.progress("Reading the PDF…");
        const bytes = await readInput(path);
        const name = fileNameFromPath(path);
        const pageCount = countPages ? (await runPdfWorker({ op: "pageCount", input: { name, bytes } }, { signal: context.signal })).pageCount : 0;
        setSource({ path, name, pageCount, size: bytes.length });
        return null;
      }),
    [job, title, countPages],
  );

  const detail = source
    ? countPages
      ? `${source.pageCount} ${source.pageCount === 1 ? "page" : "pages"} · ${formatBytes(source.size)}`
      : formatBytes(source.size)
    : null;
  return { source, choose, detail, clear: () => setSource(null) };
}
