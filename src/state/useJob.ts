import { useCallback, useRef, useState } from "react";
import { CancelledError, describeError, isCancelled } from "../lib/errors";

export type JobState =
  | { kind: "idle" }
  | { kind: "running"; label: string; percent: number | null; cancellable: boolean; cancelRequested: boolean }
  | { kind: "success"; title: string; details: string[]; warning?: string; tone: "success" | "info" }
  | { kind: "error"; message: string }
  | { kind: "cancelled"; message: string };

export interface JobContext {
  signal: AbortSignal;
  /** `percent` null = indeterminate (the engine cannot measure progress). */
  progress(label: string, percent?: number | null, cancellable?: boolean): void;
}

export interface JobResult {
  title: string;
  details?: string[];
  warning?: string;
  /** "info" for outcomes that are not a success, e.g. nothing could be improved. */
  tone?: "success" | "info";
}

/**
 * Runs one task at a time with progress, cancellation and accessible result states.
 * A task returning null means the user backed out (e.g. cancelled a dialog): back to idle.
 */
export function useJob() {
  const [state, setState] = useState<JobState>({ kind: "idle" });
  // Synchronous guard against double submission before React re-renders the disabled button.
  const busyRef = useRef(false);
  const controllerRef = useRef<AbortController | null>(null);

  const run = useCallback(async (task: (context: JobContext) => Promise<JobResult | null>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    const controller = new AbortController();
    controllerRef.current = controller;
    setState({ kind: "running", label: "Starting…", percent: null, cancellable: true, cancelRequested: false });
    const context: JobContext = {
      signal: controller.signal,
      progress: (label, percent = null, cancellable = true) =>
        setState((current) => (current.kind === "running" ? { ...current, label, percent, cancellable } : current)),
    };
    try {
      const result = await task(context);
      setState(result === null ? { kind: "idle" } : { kind: "success", title: result.title, details: result.details ?? [], warning: result.warning, tone: result.tone ?? "success" });
    } catch (error) {
      setState(isCancelled(error) || controller.signal.aborted ? { kind: "cancelled", message: new CancelledError().message } : { kind: "error", message: describeError(error) });
    } finally {
      controllerRef.current = null;
      busyRef.current = false;
    }
  }, []);

  const cancel = useCallback(() => {
    if (controllerRef.current && !controllerRef.current.signal.aborted) {
      controllerRef.current.abort();
      setState((current) => (current.kind === "running" ? { ...current, cancelRequested: true } : current));
    }
  }, []);

  const dismiss = useCallback(() => setState((current) => (current.kind === "running" ? current : { kind: "idle" })), []);
  const reset = dismiss;

  return { state, busy: state.kind === "running", run, cancel, dismiss, reset };
}

export type Job = ReturnType<typeof useJob>;
