import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { CancelledError, DocError, throwIfCancelled, type ErrorCode } from "../lib/errors";

export interface EngineInfo {
  available: boolean;
  path: string | null;
  version: string | null;
  languages: string[];
}

export interface EngineStatus {
  libreOffice: EngineInfo;
  tesseract: EngineInfo;
}

export interface NativeProgress {
  current: number;
  total: number;
}

interface NativeError {
  code: string;
  message: string;
}

const KNOWN_CODES = new Set<string>([
  "not-pdf", "not-document", "invalid-image", "encrypted", "unsupported", "empty",
  "engine-missing", "conversion-failed", "timeout", "internal",
]);

function isNativeError(value: unknown): value is NativeError {
  return typeof value === "object" && value !== null && "code" in value && "message" in value;
}

function toError(error: unknown): Error {
  if (isNativeError(error)) {
    if (error.code === "cancelled") return new CancelledError();
    const code = (KNOWN_CODES.has(error.code) ? error.code : "internal") as ErrorCode;
    return new DocError(code, error.message);
  }
  return new DocError("internal", "The local processing engine reported an unexpected error.");
}

let nextJobId = 0;

/**
 * Sends `input` to a native byte-in/byte-out command and returns the result bytes.
 * Aborting `signal` asks the native side to stop (killing any external engine process).
 */
export async function runNative(
  command: "compress_pdf" | "convert_word_to_pdf" | "ocr_image",
  input: Uint8Array,
  headers: Record<string, string>,
  options: { signal?: AbortSignal; onProgress?: (progress: NativeProgress) => void } = {},
): Promise<Uint8Array> {
  throwIfCancelled(options.signal);
  const jobId = `job-${Date.now()}-${nextJobId++}`;
  const unlisten = options.onProgress
    ? await listen<NativeProgress & { jobId: string }>("job-progress", (event) => {
        if (event.payload.jobId === jobId) options.onProgress?.(event.payload);
      })
    : null;
  const onAbort = () => void invoke("cancel_job", { jobId }).catch(() => undefined);
  options.signal?.addEventListener("abort", onAbort);
  try {
    const result = await invoke<ArrayBuffer>(command, input, { headers: { ...headers, "x-job-id": jobId } });
    throwIfCancelled(options.signal);
    return new Uint8Array(result);
  } catch (error) {
    if (error instanceof CancelledError || options.signal?.aborted) throw new CancelledError();
    throw toError(error);
  } finally {
    options.signal?.removeEventListener("abort", onAbort);
    unlisten?.();
  }
}

export async function getEngineStatus(): Promise<EngineStatus> {
  return invoke<EngineStatus>("engine_status");
}
