import { open, save } from "@tauri-apps/plugin-dialog";
import { exists, readFile, stat, writeFile } from "@tauri-apps/plugin-fs";
import { DocError } from "../lib/errors";
import { uniqueFilePath } from "../lib/naming";
import { fileNameFromPath } from "../lib/paths";
import type { FileAccess } from "../lib/workflow";

export interface FileFilter {
  name: string;
  extensions: string[];
}

export const PDF_FILTER: FileFilter[] = [{ name: "PDF documents", extensions: ["pdf"] }];
export const IMAGE_FILTER: FileFilter[] = [{ name: "Images (JPEG, PNG)", extensions: ["jpg", "jpeg", "png"] }];
export const WORD_FILTER: FileFilter[] = [{ name: "Word documents", extensions: ["docx", "doc", "odt", "rtf"] }];
export const DOCX_FILTER: FileFilter[] = [{ name: "Word document", extensions: ["docx"] }];

/** Per-file cap for single-file tools; documents are processed in memory. */
export const MAX_INPUT_BYTES = 512 * 1024 * 1024;

/** Opens the native multi-file picker. Returns [] if the user cancels. */
export async function pickFiles(title: string, filters: FileFilter[]): Promise<string[]> {
  return (await open({ title, multiple: true, directory: false, filters })) ?? [];
}

/** Opens the native single-file picker. Returns null if the user cancels. */
export async function pickFile(title: string, filters: FileFilter[]): Promise<string | null> {
  return open({ title, multiple: false, directory: false, filters });
}

/** Opens the native folder picker. The folder's files become writable for this session. */
export async function pickFolder(title: string): Promise<string | null> {
  return open({ title, multiple: false, directory: true });
}

/** Opens the native save dialog (Windows asks before replacing an existing file). */
export async function pickSavePath(title: string, defaultPath: string, filters: FileFilter[]): Promise<string | null> {
  return save({ title, defaultPath, filters });
}

export async function pickPdfFiles(): Promise<string[]> {
  return pickFiles("Select PDF files to merge", PDF_FILTER);
}

export async function pickOutputPath(defaultPath: string): Promise<string | null> {
  return pickSavePath("Save merged PDF as", defaultPath, PDF_FILTER);
}

/** Reads a user-selected file with a size cap and friendly errors (file name only, never the path). */
export async function readInput(path: string, maxBytes = MAX_INPUT_BYTES): Promise<Uint8Array> {
  const name = fileNameFromPath(path);
  let size: number;
  try {
    size = (await stat(path)).size;
  } catch {
    throw new DocError("read-failed", `"${name}" could not be opened. It may have been moved, deleted or locked.`, name);
  }
  if (size > maxBytes) {
    throw new DocError(
      "too-large",
      `"${name}" is larger than ${Math.round(maxBytes / (1024 * 1024))} MB, which DocCraft cannot process safely yet.`,
      name,
    );
  }
  try {
    return await readFile(path);
  } catch {
    throw new DocError("read-failed", `"${name}" could not be read. It may have been moved, deleted or locked.`, name);
  }
}

export async function writeOutput(path: string, bytes: Uint8Array): Promise<void> {
  const name = fileNameFromPath(path);
  try {
    await writeFile(path, bytes);
  } catch {
    throw new DocError(
      "write-failed",
      `"${name}" could not be saved. Check that the folder exists, you have permission to write there, and the file is not open in another program.`,
      name,
    );
  }
}

/** A free path in `folder` (never an existing file); `reserved` holds names chosen earlier in this run. */
export async function freeOutputPath(folder: string, stem: string, extension: string, reserved?: ReadonlySet<string>): Promise<string> {
  return uniqueFilePath(folder, stem, extension, (path) => exists(path).catch(() => true), reserved);
}

/**
 * Reads and writes only work for paths the user picked in the dialogs above:
 * the app grants no static fs scope (see src-tauri/capabilities/default.json).
 */
export const tauriFileAccess: FileAccess = {
  fileSize: async (path) => (await stat(path)).size,
  readFile: (path) => readFile(path),
  writeFile: (path, bytes) => writeFile(path, bytes),
};
