export type MergeErrorCode =
  | "not-enough-files"
  | "invalid-output"
  | "too-large"
  | "read-failed"
  | "not-pdf"
  | "encrypted"
  | "unsupported"
  | "empty"
  | "write-failed";

/** An expected, user-explainable failure. `fileName` is a file name only, never a full path. */
export class MergeError extends Error {
  readonly code: MergeErrorCode;
  readonly fileName?: string;

  constructor(code: MergeErrorCode, message: string, fileName?: string) {
    super(message);
    this.name = "MergeError";
    this.code = code;
    this.fileName = fileName;
  }
}

export class MergeCancelledError extends Error {
  constructor() {
    super("The merge was cancelled. No output file was written.");
    this.name = "MergeCancelledError";
  }
}

export function throwIfCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new MergeCancelledError();
  }
}

/** Converts any thrown value to a message that is safe and helpful to show to the user. */
export function describeError(error: unknown): string {
  if (error instanceof MergeError || error instanceof MergeCancelledError) {
    return error.message;
  }
  return "Something unexpected went wrong while merging. No output file was written by DocCraft.";
}
