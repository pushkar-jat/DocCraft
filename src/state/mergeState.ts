import type { MergeProgress } from "../lib/merge";
import { addFiles, moveFile, removeFile, type SelectedFile } from "../lib/selection";

export type MergeStatus =
  | { kind: "idle" }
  | { kind: "picking-files" }
  | { kind: "choosing-output" }
  | { kind: "merging"; progress: MergeProgress | null; cancelRequested: boolean }
  | { kind: "success"; outputName: string; pageCount: number; fileCount: number }
  | { kind: "cancelled"; message: string }
  | { kind: "error"; message: string };

export interface MergeState {
  files: SelectedFile[];
  status: MergeStatus;
  /** Informational message about the last selection (duplicates, skipped files). */
  notice: string | null;
}

export type MergeAction =
  | { type: "pick-started" }
  | { type: "files-picked"; paths: string[] }
  | { type: "pick-failed"; message: string }
  | { type: "remove"; id: string }
  | { type: "move"; id: string; offset: number }
  | { type: "clear" }
  | { type: "output-dialog-opened" }
  | { type: "output-dialog-cancelled" }
  | { type: "merge-started" }
  | { type: "merge-progress"; progress: MergeProgress }
  | { type: "cancel-requested" }
  | { type: "merge-succeeded"; outputName: string; pageCount: number; fileCount: number }
  | { type: "merge-cancelled"; message: string }
  | { type: "merge-failed"; message: string }
  | { type: "dismiss-status" };

export const initialMergeState: MergeState = { files: [], status: { kind: "idle" }, notice: null };

/** True while a dialog or merge is in flight; list edits and new merges are blocked. */
export function isBusy(status: MergeStatus): boolean {
  return status.kind === "picking-files" || status.kind === "choosing-output" || status.kind === "merging";
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function describeSelection(added: number, duplicates: string[], rejected: string[]): string | null {
  const parts: string[] = [];
  if (duplicates.length > 0) {
    parts.push(`${plural(duplicates.length, "file")} already in the list ${duplicates.length === 1 ? "was" : "were"} skipped: ${duplicates.join(", ")}.`);
  }
  if (rejected.length > 0) {
    parts.push(`${plural(rejected.length, "file")} without a .pdf extension ${rejected.length === 1 ? "was" : "were"} skipped: ${rejected.join(", ")}.`);
  }
  if (parts.length === 0) {
    return null;
  }
  return added > 0 ? `Added ${plural(added, "file")}. ${parts.join(" ")}` : parts.join(" ");
}

/** Editing the list makes a previous result stale, so return to idle. */
function afterEdit(state: MergeState, files: SelectedFile[]): MergeState {
  if (isBusy(state.status)) {
    return state;
  }
  return { files, status: { kind: "idle" }, notice: null };
}

export function mergeReducer(state: MergeState, action: MergeAction): MergeState {
  switch (action.type) {
    case "pick-started":
      return isBusy(state.status) ? state : { ...state, status: { kind: "picking-files" }, notice: null };
    case "files-picked": {
      // An empty list means the dialog was cancelled: restore idle and keep the list untouched.
      const result = addFiles(state.files, action.paths);
      return {
        files: result.files,
        status: { kind: "idle" },
        notice: describeSelection(result.added, result.duplicates, result.rejected),
      };
    }
    case "pick-failed":
      return { ...state, status: { kind: "error", message: action.message } };
    case "remove":
      return afterEdit(state, removeFile(state.files, action.id));
    case "move":
      return afterEdit(state, moveFile(state.files, action.id, action.offset));
    case "clear":
      return afterEdit(state, []);
    case "output-dialog-opened":
      return isBusy(state.status) ? state : { ...state, status: { kind: "choosing-output" }, notice: null };
    case "output-dialog-cancelled":
      return { ...state, status: { kind: "idle" } };
    case "merge-started":
      return { ...state, status: { kind: "merging", progress: null, cancelRequested: false } };
    case "merge-progress":
      return state.status.kind === "merging"
        ? { ...state, status: { ...state.status, progress: action.progress } }
        : state;
    case "cancel-requested":
      return state.status.kind === "merging" ? { ...state, status: { ...state.status, cancelRequested: true } } : state;
    case "merge-succeeded":
      return {
        ...state,
        status: { kind: "success", outputName: action.outputName, pageCount: action.pageCount, fileCount: action.fileCount },
      };
    case "merge-cancelled":
      return { ...state, status: { kind: "cancelled", message: action.message } };
    case "merge-failed":
      return { ...state, status: { kind: "error", message: action.message } };
    case "dismiss-status":
      return isBusy(state.status) ? state : { ...state, status: { kind: "idle" }, notice: null };
  }
}
