import { progressLabel, progressPercent } from "../lib/progress";
import type { MergeStatus as Status } from "../state/mergeState";

interface MergeStatusProps {
  status: Status;
  onCancel: () => void;
  onDismiss: () => void;
}

export function MergeStatus({ status, onCancel, onDismiss }: MergeStatusProps) {
  switch (status.kind) {
    case "idle":
    case "picking-files":
      return null;

    case "choosing-output":
      return (
        <div className="status status--info" role="status">
          Choose where to save the merged PDF in the dialog.
        </div>
      );

    case "merging": {
      const percent = progressPercent(status.progress);
      // Once writing has started it cannot be safely interrupted.
      const canCancel = !status.cancelRequested && status.progress?.stage !== "saving";
      return (
        <div className="status status--busy" role="status" aria-live="polite">
          <div className="status-row">
            <span>{status.cancelRequested ? "Cancelling…" : progressLabel(status.progress)}</span>
            <button type="button" className="button button--secondary" onClick={onCancel} disabled={!canCancel}>
              Cancel
            </button>
          </div>
          <div
            className="progress"
            role="progressbar"
            aria-label="Merge progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
          >
            <div className="progress-bar" style={{ width: `${percent}%` }} />
          </div>
        </div>
      );
    }

    case "success":
      return (
        <div className="status status--success" role="status">
          <div className="status-row">
            <span>
              <strong>Done.</strong> Merged {status.fileCount} files ({status.pageCount}{" "}
              {status.pageCount === 1 ? "page" : "pages"}) into <strong>{status.outputName}</strong>.
            </span>
            <button type="button" className="button button--ghost" onClick={onDismiss}>
              Dismiss
            </button>
          </div>
        </div>
      );

    case "cancelled":
      return (
        <div className="status status--info" role="status">
          <div className="status-row">
            <span>{status.message}</span>
            <button type="button" className="button button--ghost" onClick={onDismiss}>
              Dismiss
            </button>
          </div>
        </div>
      );

    case "error":
      return (
        <div className="status status--error" role="alert">
          <div className="status-row">
            <span>
              <strong>Merge failed.</strong> {status.message}
            </span>
            <button type="button" className="button button--ghost" onClick={onDismiss}>
              Dismiss
            </button>
          </div>
        </div>
      );
  }
}
