import { describe, expect, it } from "vitest";
import { progressPercent } from "../lib/progress";
import { initialMergeState, isBusy, mergeReducer, type MergeState } from "./mergeState";

const withFiles = (paths: string[]): MergeState =>
  mergeReducer(mergeReducer(initialMergeState, { type: "pick-started" }), { type: "files-picked", paths });

describe("mergeReducer", () => {
  it("cancelling the file dialog leaves the list unchanged and returns to idle", () => {
    const state = withFiles(["C:\\a.pdf"]);
    const next = mergeReducer(mergeReducer(state, { type: "pick-started" }), { type: "files-picked", paths: [] });
    expect(next.files).toEqual(state.files);
    expect(next.status).toEqual({ kind: "idle" });
    expect(next.notice).toBeNull();
  });

  it("explains skipped duplicates", () => {
    const state = withFiles(["C:\\a.pdf"]);
    const next = mergeReducer(state, { type: "files-picked", paths: ["C:\\a.pdf", "C:\\b.pdf"] });
    expect(next.files).toHaveLength(2);
    expect(next.notice).toMatch(/Added 1 file\..*already in the list.*a\.pdf/);
  });

  it("ignores list edits while a merge is running", () => {
    const state = mergeReducer(withFiles(["C:\\a.pdf", "C:\\b.pdf"]), { type: "merge-started" });
    expect(mergeReducer(state, { type: "remove", id: state.files[0].id })).toBe(state);
    expect(mergeReducer(state, { type: "move", id: state.files[0].id, offset: 1 })).toBe(state);
    expect(mergeReducer(state, { type: "clear" })).toBe(state);
  });

  it("is busy during dialogs and merging only", () => {
    expect(isBusy({ kind: "idle" })).toBe(false);
    expect(isBusy({ kind: "picking-files" })).toBe(true);
    expect(isBusy({ kind: "choosing-output" })).toBe(true);
    expect(isBusy({ kind: "merging", progress: null, cancelRequested: false })).toBe(true);
    expect(isBusy({ kind: "error", message: "x" })).toBe(false);
  });

  it("cancelling the save dialog returns to idle without changing the files", () => {
    const state = withFiles(["C:\\a.pdf", "C:\\b.pdf"]);
    const opened = mergeReducer(state, { type: "output-dialog-opened" });
    const cancelled = mergeReducer(opened, { type: "output-dialog-cancelled" });
    expect(cancelled.status).toEqual({ kind: "idle" });
    expect(cancelled.files).toEqual(state.files);
  });

  it("tracks cancel requests and the final outcome", () => {
    let state = mergeReducer(withFiles(["C:\\a.pdf", "C:\\b.pdf"]), { type: "merge-started" });
    state = mergeReducer(state, { type: "cancel-requested" });
    expect(state.status).toMatchObject({ kind: "merging", cancelRequested: true });
    state = mergeReducer(state, { type: "merge-cancelled", message: "Cancelled." });
    expect(state.status).toEqual({ kind: "cancelled", message: "Cancelled." });
  });

  it("editing the list after a result clears the stale status", () => {
    let state = withFiles(["C:\\a.pdf", "C:\\b.pdf", "C:\\c.pdf"]);
    state = mergeReducer(state, { type: "merge-failed", message: "boom" });
    state = mergeReducer(state, { type: "remove", id: state.files[2].id });
    expect(state.status).toEqual({ kind: "idle" });
    expect(state.files).toHaveLength(2);
  });
});

describe("progressPercent", () => {
  it("increases through the stages and stays within 0-100", () => {
    const values = [
      progressPercent(null),
      progressPercent({ stage: "reading", current: 1, total: 2 }),
      progressPercent({ stage: "reading", current: 2, total: 2 }),
      progressPercent({ stage: "merging", current: 1, total: 2 }),
      progressPercent({ stage: "merging", current: 2, total: 2 }),
      progressPercent({ stage: "saving", current: 2, total: 2 }),
    ];
    expect(values).toEqual([...values].sort((a, b) => a - b));
    expect(Math.min(...values)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...values)).toBeLessThanOrEqual(100);
  });
});
