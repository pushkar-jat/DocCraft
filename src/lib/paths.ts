/**
 * Pure path helpers. They work on Windows (`C:\a\b.pdf`, `\\server\share\b.pdf`)
 * and POSIX (`/a/b.pdf`) paths without depending on Node or Tauri.
 */

const SEPARATORS = /[\\/]+/;

/** Returns the last path segment, e.g. `C:\Docs\report.pdf` -> `report.pdf`. */
export function fileNameFromPath(path: string): string {
  const trimmed = path.trim().replace(/[\\/]+$/, "");
  const parts = trimmed.split(SEPARATORS);
  return parts[parts.length - 1] || trimmed;
}

/** Returns the directory portion of a path including its trailing separator, or "". */
export function directoryOfPath(path: string): string {
  const index = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
  return index >= 0 ? path.slice(0, index + 1) : "";
}

/**
 * Builds a comparison key so the same file is recognised regardless of slash
 * direction, repeated separators, `.` segments or letter case.
 *
 * Case-insensitive on every platform on purpose: Windows and default macOS
 * volumes are case-insensitive, and on Linux treating `A.pdf` and `a.pdf` as the
 * same only ever produces a visible "already selected" notice or a refusal to
 * write the output, both of which are safe.
 */
export function pathKey(path: string): string {
  const unc = /^[\\/]{2}/.test(path);
  const segments = path
    .trim()
    .split(SEPARATORS)
    .filter((segment) => segment !== "" && segment !== ".");
  const joined = segments.join("/");
  return ((unc ? "//" : path.startsWith("/") ? "/" : "") + joined).toLowerCase();
}

export function isSamePath(a: string, b: string): boolean {
  return pathKey(a) === pathKey(b);
}

export function hasPdfExtension(path: string): boolean {
  return /\.pdf$/i.test(fileNameFromPath(path));
}
