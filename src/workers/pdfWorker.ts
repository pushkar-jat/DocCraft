// Runs pdf-lib work off the UI thread. Cancelling terminates this worker outright.
import { applyOverlays } from "../lib/annotate";
import { DocError } from "../lib/errors";
import { assembleRedacted } from "../lib/redact";
import { fillForm, readForm } from "../lib/forms";
import { imagesToPdf } from "../lib/images";
import { mergePdfs } from "../lib/merge";
import { addPageNumbers, addWatermark, cropPages, organizePages, removePages, rotatePages, salvagePdf } from "../lib/pageTools";
import { extractPages, pageCountOf, splitPdf } from "../lib/split";
import type { PageTool, WorkerRequest, WorkerResponse } from "./pdfWorkerProtocol";

const scope = self as unknown as {
  postMessage(message: WorkerResponse, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
};

const progress = (current: number, total: number, stage?: string) => scope.postMessage({ type: "progress", current, total, stage });

function buffersOf(outputs: Uint8Array[]): Transferable[] {
  return outputs.map((bytes) => bytes.buffer as ArrayBuffer);
}

function runPageTool(input: Parameters<typeof removePages>[0], params: PageTool): Promise<Uint8Array> {
  const options = { onProgress: (p: { current: number; total: number }) => progress(p.current, p.total) };
  switch (params.tool) {
    case "remove":
      return removePages(input, params.remove, options);
    case "rotate":
      return rotatePages(input, params.selection, params.by, options);
    case "organize":
      return organizePages(input, params.items, options);
    case "pageNumbers":
      return addPageNumbers(input, params.settings, options);
    case "watermark":
      return addWatermark(input, params.settings, options);
    case "crop":
      return cropPages(input, params.selection, params.margins, options);
  }
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
      case "pageTool": {
        const output = await runPageTool(request.input, request.params);
        scope.postMessage({ type: "done", outputs: [output], pageCount: 1 }, buffersOf([output]));
        break;
      }
      case "overlay": {
        const output = await applyOverlays(request.input, request.items);
        scope.postMessage({ type: "done", outputs: [output], pageCount: 1 }, buffersOf([output]));
        break;
      }
      case "assembleRedacted": {
        const output = await assembleRedacted(request.input, request.pages);
        scope.postMessage({ type: "done", outputs: [output], pageCount: 1 }, buffersOf([output]));
        break;
      }
      case "readForm": {
        scope.postMessage({ type: "done", outputs: [], pageCount: 0, form: await readForm(request.input) });
        break;
      }
      case "fillForm": {
        const output = await fillForm(request.input, request.values, { flatten: request.flatten });
        scope.postMessage({ type: "done", outputs: [output], pageCount: 1 }, buffersOf([output]));
        break;
      }
      case "salvage": {
        const result = await salvagePdf(request.input);
        scope.postMessage({ type: "done", outputs: [result.bytes], pageCount: result.pageCount }, buffersOf([result.bytes]));
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
