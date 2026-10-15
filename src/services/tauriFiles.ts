import { open, save } from "@tauri-apps/plugin-dialog";
import { readFile, stat, writeFile } from "@tauri-apps/plugin-fs";
import type { FileAccess } from "../lib/workflow";

const PDF_FILTER = [{ name: "PDF documents", extensions: ["pdf"] }];

/** Opens the native multi-file picker. Returns [] if the user cancels. */
export async function pickPdfFiles(): Promise<string[]> {
  const selection = await open({
    title: "Select PDF files to merge",
    multiple: true,
    directory: false,
    filters: PDF_FILTER,
  });
  return selection ?? [];
}

/** Opens the native save dialog. Returns null if the user cancels. */
export async function pickOutputPath(defaultPath: string): Promise<string | null> {
  return save({
    title: "Save merged PDF as",
    defaultPath,
    filters: PDF_FILTER,
  });
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
