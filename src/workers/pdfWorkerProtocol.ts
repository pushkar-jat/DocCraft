import type { OverlayItem } from "../lib/annotate";
import type { ErrorCode } from "../lib/errors";
import type { RedactedPage } from "../lib/redact";
import type { FieldValue, FormInfo } from "../lib/forms";
import type { ImageInput, PageSizeMode } from "../lib/images";
import type { PdfInput } from "../lib/merge";
import type { PageRange } from "../lib/pageRanges";
import type { Margins } from "../lib/pageGeometry";
import type { OrganizeItem, PageNumberOptions, PageSelection, WatermarkOptions } from "../lib/pageTools";

export type PageTool =
  | { tool: "remove"; remove: PageRange[] }
  | { tool: "rotate"; selection: PageSelection; by: 90 | 180 | 270 }
  | { tool: "organize"; items: OrganizeItem[] }
  | { tool: "pageNumbers"; settings: PageNumberOptions }
  | { tool: "watermark"; settings: WatermarkOptions }
  | { tool: "crop"; selection: PageSelection; margins: Margins };

export type WorkerRequest =
  | { op: "merge"; inputs: PdfInput[] }
  | { op: "pageCount"; input: PdfInput }
  | { op: "split"; input: PdfInput; ranges: PageRange[] }
  | { op: "extract"; input: PdfInput; ranges: PageRange[] }
  | { op: "images"; images: ImageInput[]; pageSize: PageSizeMode }
  | { op: "pageTool"; input: PdfInput; params: PageTool }
  | { op: "salvage"; input: PdfInput }
  | { op: "overlay"; input: PdfInput; items: OverlayItem[] }
  | { op: "assembleRedacted"; input: PdfInput; pages: RedactedPage[] }
  | { op: "readForm"; input: PdfInput }
  | { op: "fillForm"; input: PdfInput; values: Record<string, FieldValue>; flatten: boolean };

export type WorkerResponse =
  | { type: "progress"; current: number; total: number; stage?: string }
  /** `form` is set by readForm; `outputs` is empty then. */
  | { type: "done"; outputs: Uint8Array[]; pageCount: number; form?: FormInfo }
  | { type: "error"; code: ErrorCode; message: string; fileName?: string };
