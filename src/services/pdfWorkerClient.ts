import { CancelledError, DocError } from "../lib/errors";
import type { MergeProgress } from "../lib/merge";
import type { MergeFunction } from "../lib/workflow";
import type { WorkerRequest, WorkerResponse } from "../workers/pdfWorkerProtocol";

export interface WorkerOptions {
  signal?: AbortSignal;
  onProgress?: (progress: { current: number; total: number; stage?: string }) => void;
}

/**
 * Runs one pdf-lib job in a fresh Web Worker so the UI stays responsive.
 * Cancelling terminates the worker immediately; nothing it produced is used.
 */
export function runPdfWorker(request: WorkerRequest, options: WorkerOptions = {}): Promise<{ outputs: Uint8Array[]; pageCount: number }> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(new CancelledError());
      return;
    }
    const worker = new Worker(new URL("../workers/pdfWorker.ts", import.meta.url), { type: "module" });
    const finish = () => {
      worker.terminate();
      options.signal?.removeEventListener("abort", onAbort);
    };
    const onAbort = () => {
      finish();
      reject(new CancelledError());
    };
    options.signal?.addEventListener("abort", onAbort);

    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data;
      if (message.type === "progress") {
        options.onProgress?.(message);
      } else if (message.type === "done") {
        finish();
        resolve({ outputs: message.outputs, pageCount: message.pageCount });
      } else {
        finish();
        reject(new DocError(message.code, message.message, message.fileName));
      }
    };
    worker.onerror = () => {
      finish();
      reject(new DocError("internal", "The PDF engine stopped unexpectedly. The file may be too large or damaged."));
    };
    // Inputs are copied into the worker (not transferred) so callers keep usable buffers.
    worker.postMessage(request);
  });
}

/** Merge implementation for runMergeWorkflow that runs in a Web Worker. */
export const mergeInWorker: MergeFunction = async (inputs, options) => {
  const result = await runPdfWorker(
    { op: "merge", inputs },
    {
      signal: options.signal,
      onProgress: (p) => options.onProgress?.({ stage: (p.stage as MergeProgress["stage"]) ?? "merging", current: p.current, total: p.total }),
    },
  );
  return { bytes: result.outputs[0], pageCount: result.pageCount };
};
