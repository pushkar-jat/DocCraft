import type { ErrorCode } from "../lib/errors";
import type { ImageInput, PageSizeMode } from "../lib/images";
import type { PdfInput } from "../lib/merge";
import type { PageRange } from "../lib/pageRanges";

export type WorkerRequest =
  | { op: "merge"; inputs: PdfInput[] }
  | { op: "pageCount"; input: PdfInput }
  | { op: "split"; input: PdfInput; ranges: PageRange[] }
  | { op: "extract"; input: PdfInput; ranges: PageRange[] }
  | { op: "images"; images: ImageInput[]; pageSize: PageSizeMode };

export type WorkerResponse =
  | { type: "progress"; current: number; total: number; stage?: string }
  | { type: "done"; outputs: Uint8Array[]; pageCount: number }
  | { type: "error"; code: ErrorCode; message: string; fileName?: string };
