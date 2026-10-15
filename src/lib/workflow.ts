import { DocError, throwIfCancelled } from "./errors";
import type { MergeOptions, MergeProgress, MergeResult, PdfInput } from "./merge";
import { fileNameFromPath } from "./paths";
import { validateOutputPath } from "./selection";

/** pdf-lib holds every input and the output in memory, so cap the total input size. */
export const MAX_TOTAL_INPUT_BYTES = 1024 * 1024 * 1024; // 1 GiB

/** File operations the workflow needs. Implemented with Tauri plugins in the app, faked in tests. */
export interface FileAccess {
  fileSize(path: string): Promise<number>;
  readFile(path: string): Promise<Uint8Array>;
  writeFile(path: string, bytes: Uint8Array): Promise<void>;
}

export type MergeFunction = (inputs: PdfInput[], options: MergeOptions) => Promise<MergeResult>;

export interface WorkflowOptions {
  /** The merge implementation: `mergePdfs` directly (tests) or a Web Worker wrapper (app). */
  merge: MergeFunction;
  signal?: AbortSignal;
  onProgress?: (progress: MergeProgress) => void;
}

export interface WorkflowResult {
  pageCount: number;
  fileCount: number;
  outputName: string;
}

function formatMegabytes(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

/**
 * Reads the inputs, merges them in the given order and writes the result to `outputPath`.
 * Nothing is written unless every input was merged successfully and the run was not cancelled.
 * Source files are only ever read.
 */
export async function runMergeWorkflow(
  inputPaths: readonly string[],
  outputPath: string,
  files: FileAccess,
  options: WorkflowOptions,
): Promise<WorkflowResult> {
  const { merge, signal, onProgress } = options;

  const outputProblem = validateOutputPath(outputPath, inputPaths);
  if (outputProblem !== null) {
    throw new DocError("invalid-output", outputProblem);
  }

  let totalBytes = 0;
  const inputs: PdfInput[] = [];
  for (const [index, path] of inputPaths.entries()) {
    throwIfCancelled(signal);
    const name = fileNameFromPath(path);
    onProgress?.({ stage: "reading", current: index + 1, total: inputPaths.length });

    let size: number;
    try {
      size = await files.fileSize(path);
    } catch {
      throw new DocError("read-failed", `"${name}" could not be opened. It may have been moved, deleted or locked.`, name);
    }
    totalBytes += size;
    if (totalBytes > MAX_TOTAL_INPUT_BYTES) {
      throw new DocError(
        "too-large",
        `The selected files are larger than ${formatMegabytes(MAX_TOTAL_INPUT_BYTES)} in total, which DocCraft cannot merge safely yet. Merge fewer or smaller files.`,
        name,
      );
    }

    try {
      inputs.push({ name, bytes: await files.readFile(path) });
    } catch {
      throw new DocError("read-failed", `"${name}" could not be read. It may have been moved, deleted or locked.`, name);
    }
  }

  const merged = await merge(inputs, { signal, onProgress });

  // Last point at which cancelling is honoured: after this the write has started.
  throwIfCancelled(signal);
  const outputName = fileNameFromPath(outputPath);
  try {
    await files.writeFile(outputPath, merged.bytes);
  } catch {
    throw new DocError(
      "write-failed",
      `"${outputName}" could not be saved. Check that the folder exists, you have permission to write there, and the file is not open in another program.`,
      outputName,
    );
  }

  return { pageCount: merged.pageCount, fileCount: inputs.length, outputName };
}
