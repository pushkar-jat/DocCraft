import { extensionOf } from "./naming";
import { directoryOfPath, fileNameFromPath, hasPdfExtension, isSamePath, pathKey } from "./paths";

export const MIN_FILES_TO_MERGE = 2;

export interface SelectedFile {
  /** Stable id for React keys; derived from the normalised path. */
  id: string;
  path: string;
  name: string;
}

export interface AddFilesResult {
  files: SelectedFile[];
  added: number;
  duplicates: string[];
  rejected: string[];
}

export function toSelectedFile(path: string): SelectedFile {
  return { id: pathKey(path), path, name: fileNameFromPath(path) };
}

/**
 * Appends newly picked paths to the current list, keeping the existing order.
 * Paths already in the list (or repeated within the batch) are reported as
 * duplicates; paths `accepts` refuses (default: no `.pdf` extension) are reported as rejected.
 * The extension check is only a usability filter: content is validated at merge time.
 */
export function addFiles(
  current: readonly SelectedFile[],
  paths: readonly string[],
  accepts: (path: string) => boolean = hasPdfExtension,
): AddFilesResult {
  const seen = new Set(current.map((file) => file.id));
  const files = [...current];
  const duplicates: string[] = [];
  const rejected: string[] = [];

  for (const path of paths) {
    if (!accepts(path)) {
      rejected.push(fileNameFromPath(path));
      continue;
    }
    const file = toSelectedFile(path);
    if (seen.has(file.id)) {
      duplicates.push(file.name);
      continue;
    }
    seen.add(file.id);
    files.push(file);
  }

  return { files, added: files.length - current.length, duplicates, rejected };
}

export function removeFile(files: readonly SelectedFile[], id: string): SelectedFile[] {
  return files.filter((file) => file.id !== id);
}

/** Moves the file with `id` by `offset` positions (-1 = up, 1 = down). Out-of-range moves are no-ops. */
export function moveFile(files: readonly SelectedFile[], id: string, offset: number): SelectedFile[] {
  const from = files.findIndex((file) => file.id === id);
  const to = from + offset;
  if (from < 0 || to < 0 || to >= files.length || offset === 0) {
    return [...files];
  }
  const next = [...files];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/** Returns a user-facing reason why merging is not possible yet, or null if it is. */
export function mergeBlocker(files: readonly SelectedFile[]): string | null {
  if (files.length === 0) {
    return `Add at least ${MIN_FILES_TO_MERGE} PDF files to merge.`;
  }
  if (files.length < MIN_FILES_TO_MERGE) {
    return `Add at least one more PDF. Merging needs ${MIN_FILES_TO_MERGE} or more files.`;
  }
  return null;
}

/** Returns a user-facing error if the chosen output path is unsafe, or null if it is acceptable. */
export function validateOutputPath(outputPath: string, inputPaths: readonly string[], extension = "pdf"): string | null {
  if (extensionOf(outputPath) !== extension) {
    return `The output file name must end in .${extension}. Choose the save location again.`;
  }
  const clash = inputPaths.find((input) => isSamePath(input, outputPath));
  if (clash !== undefined) {
    return `The output cannot replace one of the files being merged (${fileNameFromPath(clash)}). Choose a different file name.`;
  }
  return null;
}

/** Suggests `merged.pdf` next to the first input, avoiding the names of the inputs. */
/** Extension filter for `addFiles`, e.g. `hasExtension(["jpg", "jpeg", "png"])`. */
export function hasExtension(extensions: readonly string[]): (path: string) => boolean {
  const allowed = new Set(extensions.map((extension) => extension.toLowerCase()));
  return (path) => allowed.has(extensionOf(path));
}

export function suggestOutputPath(inputPaths: readonly string[]): string {
  const directory = inputPaths.length > 0 ? directoryOfPath(inputPaths[0]) : "";
  for (let attempt = 0; ; attempt++) {
    const name = attempt === 0 ? "merged.pdf" : `merged (${attempt}).pdf`;
    const candidate = directory + name;
    if (!inputPaths.some((input) => isSamePath(input, candidate))) {
      return candidate;
    }
  }
}
