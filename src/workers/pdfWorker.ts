// Runs pdf-lib work off the UI thread. Cancelling terminates this worker outright.
import { DocError } from "../lib/errors";
import { imagesToPdf } from "../lib/images";
import { mergePdfs } from "../lib/merge";
import { extractPages, pageCountOf, splitPdf } from "../lib/split";
import type { WorkerRequest, WorkerResponse } from "./pdfWorkerProtocol";

const scope = self as unknown as {
  postMessage(message: WorkerResponse, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
};

const progress = (current: number, total: number, stage?: string) => scope.postMessage({ type: "progress", current, total, stage });

function buffersOf(outputs: Uint8Array[]): Transferable[] {
  return outputs.map((bytes) => bytes.buffer as ArrayBuffer);
}

scope.onmessage = async (event) => {
  const request = event.data;
  try {
    switch (request.op) {
      case "merge": {
        const result = await mergePdfs(request.inputs, { onProgress: (p) => progress(p.current, p.total, p.stage) });
        scope.postMessage({ type: "done", outputs: [result.bytes], pageCount: result.pageCount }, buffersOf([result.bytes]));
        break;
      }
      case "pageCount": {
        const pageCount = await pageCountOf(request.input);
        scope.postMessage({ type: "done", outputs: [], pageCount });
        break;
      }
      case "split": {
        const outputs = await splitPdf(request.input, request.ranges, { onProgress: (p) => progress(p.current, p.total) });
        scope.postMessage({ type: "done", outputs, pageCount: outputs.length }, buffersOf(outputs));
        break;
      }
      case "extract": {
        const output = await extractPages(request.input, request.ranges, { onProgress: (p) => progress(p.current, p.total) });
        scope.postMessage({ type: "done", outputs: [output], pageCount: 1 }, buffersOf([output]));
        break;
      }
      case "images": {
        const result = await imagesToPdf(request.images, { pageSize: request.pageSize, onProgress: (p) => progress(p.current, p.total) });
        scope.postMessage({ type: "done", outputs: [result.bytes], pageCount: result.pageCount }, buffersOf([result.bytes]));
        break;
      }
    }
  } catch (error) {
    if (error instanceof DocError) {
      scope.postMessage({ type: "error", code: error.code, message: error.message, fileName: error.fileName });
    } else {
      scope.postMessage({ type: "error", code: "internal", message: "Something unexpected went wrong while processing the PDF." });
    }
  }
};
