import { useCallback, useReducer, useRef } from "react";
import { describeError, MergeCancelledError } from "../lib/errors";
import { mergeBlocker, suggestOutputPath } from "../lib/selection";
import { pickOutputPath, pickPdfFiles, tauriFileAccess } from "../services/tauriFiles";
import { initialMergeState, isBusy, mergeReducer } from "./mergeState";

export function useMergeTool() {
  const [state, dispatch] = useReducer(mergeReducer, initialMergeState);
  // Synchronous guard against double submission before React re-renders the disabled button.
  const busyRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  const addPdfs = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    dispatch({ type: "pick-started" });
    try {
      const paths = await pickPdfFiles();
      dispatch({ type: "files-picked", paths });
    } catch {
      dispatch({ type: "pick-failed", message: "The file picker could not be opened. Please try again." });
    } finally {
      busyRef.current = false;
    }
  }, []);

  const merge = useCallback(async () => {
    if (busyRef.current || mergeBlocker(state.files) !== null) return;
    busyRef.current = true;
    const inputPaths = state.files.map((file) => file.path);
    try {
      dispatch({ type: "output-dialog-opened" });
      let outputPath: string | null;
      try {
        outputPath = await pickOutputPath(suggestOutputPath(inputPaths));
      } catch {
        dispatch({ type: "merge-failed", message: "The save dialog could not be opened. Please try again." });
        return;
      }
      if (outputPath === null) {
        dispatch({ type: "output-dialog-cancelled" });
        return;
      }

      const controller = new AbortController();
      abortRef.current = controller;
      dispatch({ type: "merge-started" });
      // pdf-lib is large; load it only when a merge actually runs.
      const { runMergeWorkflow } = await import("../lib/workflow");
      const result = await runMergeWorkflow(inputPaths, outputPath, tauriFileAccess, {
        signal: controller.signal,
        onProgress: (progress) => dispatch({ type: "merge-progress", progress }),
      });
      dispatch({ type: "merge-succeeded", ...result });
    } catch (error) {
      if (error instanceof MergeCancelledError) {
        dispatch({ type: "merge-cancelled", message: error.message });
      } else {
        dispatch({ type: "merge-failed", message: describeError(error) });
      }
    } finally {
      abortRef.current = null;
      busyRef.current = false;
    }
  }, [state.files]);

  const cancel = useCallback(() => {
    if (abortRef.current && !abortRef.current.signal.aborted) {
      abortRef.current.abort();
      dispatch({ type: "cancel-requested" });
    }
  }, []);

  return {
    state,
    busy: isBusy(state.status),
    blocker: mergeBlocker(state.files),
    addPdfs,
    merge,
    cancel,
    remove: (id: string) => dispatch({ type: "remove", id }),
    move: (id: string, offset: number) => dispatch({ type: "move", id, offset }),
    clear: () => dispatch({ type: "clear" }),
    dismissStatus: () => dispatch({ type: "dismiss-status" }),
  };
}

export type MergeTool = ReturnType<typeof useMergeTool>;
