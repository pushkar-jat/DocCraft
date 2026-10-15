import type { Job } from "../state/useJob";

/** Accessible status region for a running or finished job. */
export function JobStatus({ job }: { job: Job }) {
  const { state } = job;
  switch (state.kind) {
    case "idle":
      return null;

    case "running":
      return (
        <div className="status status--busy" role="status" aria-live="polite">
          <div className="status-row">
            <span>{state.cancelRequested ? "Cancelling…" : state.label}</span>
            <button
              type="button"
              className="button button--secondary"
              onClick={job.cancel}
              disabled={!state.cancellable || state.cancelRequested}
            >
              Cancel
            </button>
          </div>
          {state.percent === null ? (
            <div className="progress progress--indeterminate" role="progressbar" aria-label="Working" aria-busy="true">
              <div className="progress-bar" />
            </div>
          ) : (
            <div
              className="progress"
              role="progressbar"
              aria-label="Progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(state.percent)}
            >
              <div className="progress-bar" style={{ width: `${state.percent}%` }} />
            </div>
          )}
        </div>
      );

    case "success":
      return (
        <div className={`status status--${state.tone}`} role="status">
          <div className="status-row">
            <div>
              <strong>{state.title}</strong>
              {state.details.length > 0 && (
                <ul className="status-details">
                  {state.details.map((detail) => (
                    <li key={detail}>{detail}</li>
                  ))}
                </ul>
              )}
              {state.warning && <p className="status-warning">{state.warning}</p>}
            </div>
            <button type="button" className="button button--ghost" onClick={job.dismiss}>
              Dismiss
            </button>
          </div>
        </div>
      );

    case "cancelled":
      return (
        <div className="status status--info" role="status">
          <div className="status-row">
            <span>{state.message}</span>
            <button type="button" className="button button--ghost" onClick={job.dismiss}>
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
              <strong>That didn’t work.</strong> {state.message}
            </span>
            <button type="button" className="button button--ghost" onClick={job.dismiss}>
              Dismiss
            </button>
          </div>
        </div>
      );
  }
}
