import { DocError } from "../lib/errors";
import { baseName } from "../lib/naming";
import { directoryOfPath } from "../lib/paths";
import { validateOutputPath } from "../lib/selection";
import type { JobContext } from "../state/useJob";
import { pickSavePath, type FileFilter } from "./tauriFiles";

/** `<input folder>/<input base><suffix>.<extension>` as the save dialog's starting point. */
export function suggestedPath(inputPath: string, suffix: string, extension: string): string {
  return `${directoryOfPath(inputPath)}${baseName(inputPath)}${suffix}.${extension}`;
}

/**
 * Asks for the output path with the native save dialog. Returns null if the user cancels.
 * Refuses any path that is one of the inputs, so a source can never be overwritten.
 */
export async function chooseSavePath(
  context: JobContext,
  options: { title: string; suggested: string; filters: FileFilter[]; inputs: readonly string[]; extension: string },
): Promise<string | null> {
  context.progress("Choose where to save the result in the dialog.", null, false);
  const path = await pickSavePath(options.title, options.suggested, options.filters);
  if (path === null) return null;
  const problem = validateOutputPath(path, options.inputs, options.extension);
  if (problem !== null) {
    throw new DocError("invalid-output", problem);
  }
  return path;
}
