import { fileNameFromPath, pathKey } from "./paths";

/** File name without its last extension: `report.final.pdf` -> `report.final`. */
export function baseName(fileName: string): string {
  const name = fileNameFromPath(fileName);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

/** Lower-case extension without the dot, or "". */
export function extensionOf(fileName: string): string {
  const name = fileNameFromPath(fileName);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

/** Joins a folder and a file name using the folder's own separator style. */
export function joinPath(folder: string, name: string): string {
  const separator = folder.includes("\\") || /^[a-zA-Z]:/.test(folder) ? "\\" : "/";
  return folder.endsWith("\\") || folder.endsWith("/") ? folder + name : folder + separator + name;
}

/** Makes a string safe as a file name on Windows, macOS and Linux. */
export function sanitizeFileName(name: string): string {
  const cleaned = name
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/[. ]+$/, "")
    .trim();
  const safe = cleaned.slice(0, 150) || "document";
  // Windows reserves these device names regardless of extension.
  return /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i.test(safe) ? `_${safe}` : safe;
}

/** Returns `name.ext`, `name (2).ext`, … for the first candidate that is free. */
export async function uniqueFilePath(
  folder: string,
  stem: string,
  extension: string,
  exists: (path: string) => Promise<boolean>,
  reserved: ReadonlySet<string> = new Set(),
): Promise<string> {
  const safeStem = sanitizeFileName(stem);
  for (let attempt = 1; attempt <= 999; attempt++) {
    const name = attempt === 1 ? `${safeStem}.${extension}` : `${safeStem} (${attempt}).${extension}`;
    const candidate = joinPath(folder, name);
    if (!reserved.has(pathKey(candidate)) && !(await exists(candidate))) {
      return candidate;
    }
  }
  throw new Error("No free file name found");
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 2 : 1)} MB`;
}

/** Percentage change from `before` to `after`, negative when the file got smaller. */
export function percentChange(before: number, after: number): number {
  if (before <= 0) return 0;
  return Math.round(((after - before) / before) * 1000) / 10;
}
