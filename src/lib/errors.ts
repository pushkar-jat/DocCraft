export type ErrorCode =
  | "not-enough-files"
  | "invalid-output"
  | "too-large"
  | "read-failed"
  | "not-pdf"
  | "not-document"
  | "invalid-image"
  | "invalid-range"
  | "encrypted"
  | "unsupported"
  | "empty"
  | "no-text"
  | "engine-missing"
  | "conversion-failed"
  | "timeout"
  | "write-failed"
  | "wrong-password"
  | "not-encrypted"
  | "internal";

/** An expected, user-explainable failure. `fileName` is a file name only, never a full path. */
export class DocError extends Error {
  readonly code: ErrorCode;
  readonly fileName?: string;

  constructor(code: ErrorCode, message: string, fileName?: string) {
    super(message);
    this.name = "DocError";
    this.code = code;
    this.fileName = fileName;
  }
}

export class CancelledError extends Error {
  constructor() {
    super("The operation was cancelled. No output file was written.");
    this.name = "CancelledError";
  }
}

export function throwIfCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new CancelledError();
  }
}

export function isCancelled(error: unknown): boolean {
  return error instanceof CancelledError;
}

/** Converts any thrown value to a message that is safe and helpful to show to the user. */
export function describeError(error: unknown): string {
  if (error instanceof DocError || error instanceof CancelledError) {
    return error.message;
  }
  return "Something unexpected went wrong. No output file was written.";
}

/** Prefixes a DocError's message with the file it concerns, if it does not mention it already. */
export function withFileName(error: unknown, fileName: string): unknown {
  if (error instanceof DocError && !error.message.includes(fileName)) {
    return new DocError(error.code, `"${fileName}": ${error.message}`, fileName);
  }
  return error;
}
