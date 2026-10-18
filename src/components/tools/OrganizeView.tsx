import { useEffect, useRef, useState } from "react";
import { throwIfCancelled } from "../../lib/errors";
import {
  duplicateCard,
  initialCards,
  insertBlankAfter,
  isUnchanged,
  moveCard,
  removeCard,
  rotateCard,
  toOrganizeItems,
  type OrganizeCard,
} from "../../lib/organize";
import { fileNameFromPath } from "../../lib/paths";
import { chooseSavePath, suggestedPath } from "../../services/output";
import { openPdfRenderer } from "../../services/pdfjs";
import { runPdfWorker } from "../../services/pdfWorkerClient";
import { PDF_FILTER, readInput, writeOutput } from "../../services/tauriFiles";
import { useJob } from "../../state/useJob";
import { usePdfSource } from "../../state/usePdfSource";
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, TrashIcon } from "../Icons";
import { JobStatus } from "../JobStatus";
import { ActionBar, SingleFilePicker, ToolLayout } from "../ToolLayout";

/** Above this many pages thumbnails are skipped to keep memory and time reasonable. */
const MAX_THUMBNAILS = 300;

export function OrganizeView({ onBack }: { onBack: () => void }) {
  const job = useJob();
  const pdf = usePdfSource(job);
  const [cards, setCards] = useState<OrganizeCard[]>([]);
  const [thumbnails, setThumbnails] = useState<Record<number, string>>({});
  const generation = useRef(0);

  // When a new PDF is chosen: reset the cards and render thumbnails one by one in the background.
  useEffect(() => {
    const source = pdf.source;
    setCards(source ? initialCards(source.pageCount) : []);
    setThumbnails({});
    if (!source || source.pageCount > MAX_THUMBNAILS) return;
    const run = ++generation.current;
    let renderer: Awaited<ReturnType<typeof openPdfRenderer>> | null = null;
    (async () => {
      try {
        renderer = await openPdfRenderer(await readInput(source.path), source.name);
        for (let page = 1; page <= source.pageCount && run === generation.current; page++) {
          const url = await renderer.thumbnail(page, 140);
          if (run === generation.current) setThumbnails((current) => ({ ...current, [page - 1]: url }));
        }
      } catch {
        // Thumbnails are a convenience; the page numbers still identify every page.
      } finally {
        await renderer?.close();
      }
    })();
    return () => {
      generation.current++;
    };
  }, [pdf.source]);

  const source = pdf.source;
  const unchanged = source ? isUnchanged(cards, source.pageCount) : true;
  const blocker = cards.length === 0 ? "Keep at least one page." : unchanged ? "Rearrange, rotate, add or remove pages first." : null;

  const save = () =>
    job.run(async (context) => {
      if (!source) return null;
      const output = await chooseSavePath(context, {
        title: "Save organized PDF as",
        suggested: suggestedPath(source.path, "_organized", "pdf"),
        filters: PDF_FILTER,
        inputs: [source.path],
        extension: "pdf",
      });
      if (output === null) return null;
      context.progress("Building the new PDF…");
      const bytes = await readInput(source.path);
      const result = await runPdfWorker({ op: "pageTool", input: { name: source.name, bytes }, params: { tool: "organize", items: toOrganizeItems(cards) } }, { signal: context.signal });
      throwIfCancelled(context.signal);
      context.progress("Saving…", null, false);
      await writeOutput(output, result.outputs[0]);
      return { title: `Saved ${fileNameFromPath(output)} with ${cards.length} ${cards.length === 1 ? "page" : "pages"}.` };
    });

  return (
    <ToolLayout
      title="Organize PDF"
      description="Rearrange, rotate, duplicate or delete pages, and insert blank pages. The original is never changed."
      onBack={onBack}
      busy={job.busy}
    >
      <SingleFilePicker label="Select a PDF" fileName={source?.name ?? null} detail={pdf.detail} onChoose={pdf.choose} disabled={job.busy} />
      {source && (
        <div className="panel">
          <div className="panel-toolbar">
            <span className="panel-count">
              {cards.length} {cards.length === 1 ? "page" : "pages"} in the new document
            </span>
            <button type="button" className="button button--ghost" onClick={() => setCards(initialCards(source.pageCount))} disabled={job.busy || unchanged}>
              Reset
            </button>
          </div>
          {source.pageCount > MAX_THUMBNAILS && <p className="notice">This PDF has many pages, so previews are not shown. Pages are identified by number.</p>}
          <ol className="page-grid" aria-label="Pages in the new order">
            {cards.map((card, index) => {
              const label = "blank" in card ? "Blank page" : `Page ${card.source + 1}`;
              return (
                <li key={card.key} className="page-card">
                  <div className="page-thumb" aria-hidden="true">
                    {"blank" in card ? (
                      <span className="page-thumb-blank" />
                    ) : thumbnails[card.source] ? (
                      <img src={thumbnails[card.source]} alt="" style={{ transform: `rotate(${card.rotate}deg)` }} />
                    ) : (
                      <span className="page-thumb-placeholder">{card.source + 1}</span>
                    )}
                  </div>
                  <span className="page-label">
                    {index + 1}. {label}
                    {"source" in card && card.rotate !== 0 ? ` · ${card.rotate}°` : ""}
                  </span>
                  <span className="page-actions">
                    <button type="button" className="icon-button" onClick={() => setCards((c) => moveCard(c, card.key, -1))} disabled={job.busy || index === 0} aria-label={`Move ${label} earlier`} title="Move earlier">
                      <ArrowUpIcon style={{ transform: "rotate(-90deg)" }} />
                    </button>
                    <button type="button" className="icon-button" onClick={() => setCards((c) => moveCard(c, card.key, 1))} disabled={job.busy || index === cards.length - 1} aria-label={`Move ${label} later`} title="Move later">
                      <ArrowDownIcon style={{ transform: "rotate(-90deg)" }} />
                    </button>
                    {"source" in card && (
                      <>
                        <button type="button" className="icon-button" onClick={() => setCards((c) => rotateCard(c, card.key, -90))} disabled={job.busy} aria-label={`Rotate ${label} left`} title="Rotate left">
                          ⟲
                        </button>
                        <button type="button" className="icon-button" onClick={() => setCards((c) => rotateCard(c, card.key, 90))} disabled={job.busy} aria-label={`Rotate ${label} right`} title="Rotate right">
                          ⟳
                        </button>
                        <button type="button" className="icon-button" onClick={() => setCards((c) => duplicateCard(c, card.key))} disabled={job.busy} aria-label={`Duplicate ${label}`} title="Duplicate">
                          ⧉
                        </button>
                      </>
                    )}
                    <button type="button" className="icon-button" onClick={() => setCards((c) => insertBlankAfter(c, card.key))} disabled={job.busy} aria-label={`Insert a blank page after ${label}`} title="Insert blank page after">
                      <PlusIcon />
                    </button>
                    <button type="button" className="icon-button icon-button--danger" onClick={() => setCards((c) => removeCard(c, card.key))} disabled={job.busy} aria-label={`Delete ${label}`} title="Delete">
                      <TrashIcon />
                    </button>
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
      )}
      <JobStatus job={job} />
      <ActionBar hint={!source ? "Choose a PDF to start." : (blocker ?? "Ready. You will choose where to save the result next.")}>
        <button type="button" className="button button--primary button--large" onClick={save} disabled={job.busy || !source || blocker !== null}>
          Save new PDF
        </button>
      </ActionBar>
    </ToolLayout>
  );
}
