import { useEffect, useState } from "react";
import type { PdfRenderer } from "../services/pageEditing";
import { openPdfRenderer } from "../services/pdfjs";
import { readInput } from "../services/tauriFiles";
import type { PdfSource } from "./usePdfSource";

/** Keeps a pdf.js renderer open for the chosen PDF and closes it when the PDF changes or the view closes. */
export function usePdfRenderer(source: PdfSource | null): { renderer: PdfRenderer | null; error: string | null } {
  const [renderer, setRenderer] = useState<PdfRenderer | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setRenderer(null);
    setError(null);
    if (!source) return;
    let cancelled = false;
    let opened: PdfRenderer | null = null;
    (async () => {
      try {
        opened = await openPdfRenderer(await readInput(source.path), source.name);
        if (cancelled) await opened.close();
        else setRenderer(opened);
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "The PDF could not be displayed.");
      }
    })();
    return () => {
      cancelled = true;
      void opened?.close();
    };
  }, [source]);

  return { renderer, error };
}
