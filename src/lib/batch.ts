import { CancelledError, describeError } from "./errors";
import { addFiles, hasExtension } from "./selection";

export type BatchStatus = "queued" | "processing" | "succeeded" | "failed" | "cancelled";

export interface BatchItem {
  id: string;
  path: string;
  name: string;
  status: BatchStatus;
  /** Output file name on success, error text on failure. */
  detail?: string;
}

export interface BatchSummary {
  succeeded: number;
  failed: number;
  cancelled: number;
  queued: number;
}

/** Processes one item and returns the output file name. Throws on failure. */
export type BatchProcessor = (item: BatchItem, signal: AbortSignal) => Promise<string>;

/** Adds paths to the queue, skipping duplicates and files with other extensions. */
export function addBatchItems(current: readonly BatchItem[], paths: readonly string[], extensions: readonly string[]) {
  const result = addFiles(current, paths, hasExtension(extensions));
  const added = result.files.slice(current.length).map<BatchItem>((file) => ({ ...file, status: "queued" }));
  return { items: [...current, ...added], duplicates: result.duplicates, rejected: result.rejected };
}

export function summarize(items: readonly BatchItem[]): BatchSummary {
  const count = (status: BatchStatus) => items.filter((item) => item.status === status).length;
  return { succeeded: count("succeeded"), failed: count("failed"), cancelled: count("cancelled"), queued: count("queued") };
}

/** Puts failed and cancelled items back in the queue for a retry. */
export function requeueUnfinished(items: readonly BatchItem[]): BatchItem[] {
  return items.map((item) =>
    item.status === "failed" || item.status === "cancelled" ? { ...item, status: "queued", detail: undefined } : item,
  );
}

/**
 * Runs queued items one at a time (bounded memory and CPU). A failure only affects its own item.
 * Cancelling stops the current item and marks every remaining queued item as cancelled.
 */
export async function runBatch(
  items: readonly BatchItem[],
  process: BatchProcessor,
  options: { signal: AbortSignal; onUpdate: (items: BatchItem[]) => void },
): Promise<BatchItem[]> {
  let state = [...items];
  const update = (id: string, patch: Partial<BatchItem>) => {
    state = state.map((item) => (item.id === id ? { ...item, ...patch } : item));
    options.onUpdate(state);
  };

  for (const item of items) {
    if (item.status !== "queued") continue;
    if (options.signal.aborted) {
      update(item.id, { status: "cancelled", detail: "Cancelled before it started." });
      continue;
    }
    update(item.id, { status: "processing", detail: undefined });
    try {
      const output = await process(item, options.signal);
      update(item.id, { status: "succeeded", detail: output });
    } catch (error) {
      if (error instanceof CancelledError || options.signal.aborted) {
        update(item.id, { status: "cancelled", detail: "Cancelled. No output was written." });
      } else {
        update(item.id, { status: "failed", detail: describeError(error) });
      }
    }
  }
  return state;
}
