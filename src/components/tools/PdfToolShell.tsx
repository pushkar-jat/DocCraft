import type { ReactNode } from "react";
import type { Job } from "../../state/useJob";
import type { PdfSource } from "../../state/usePdfSource";
import { JobStatus } from "../JobStatus";
import { ActionBar, SingleFilePicker, ToolLayout } from "../ToolLayout";

interface PdfToolShellProps {
  title: string;
  description: string;
  onBack: () => void;
  job: Job;
  source: PdfSource | null;
  sourceDetail: string | null;
  onChoose: () => void;
  /** Option controls, shown once a PDF is chosen. */
  children?: (source: PdfSource) => ReactNode;
  /** Shown above the picker (engine notices, limitations). */
  notice?: ReactNode;
  actionLabel: string;
  onRun: () => void;
  /** Why the action is disabled, or null when ready. */
  blocker: string | null;
  readyHint?: string;
}

/** Standard single-PDF tool screen: picker → options → status → action. */
export function PdfToolShell(props: PdfToolShellProps) {
  const { job, source } = props;
  const hint = !source ? "Choose a PDF to start." : (props.blocker ?? props.readyHint ?? "Ready. You will choose where to save the result next.");
  return (
    <ToolLayout title={props.title} description={props.description} onBack={props.onBack} busy={job.busy}>
      {props.notice}
      <SingleFilePicker label="Select a PDF" fileName={source?.name ?? null} detail={props.sourceDetail} onChoose={props.onChoose} disabled={job.busy} />
      {source && props.children && (
        <fieldset className="panel form-panel" disabled={job.busy}>
          <legend className="form-legend">Options</legend>
          {props.children(source)}
        </fieldset>
      )}
      <JobStatus job={job} />
      <ActionBar hint={hint}>
        <button type="button" className="button button--primary button--large" onClick={props.onRun} disabled={job.busy || !source || props.blocker !== null}>
          {props.actionLabel}
        </button>
      </ActionBar>
    </ToolLayout>
  );
}
