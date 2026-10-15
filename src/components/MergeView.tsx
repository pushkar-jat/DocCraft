import type { MergeTool } from "../state/useMergeTool";
import { FileList } from "./FileList";
import { BackIcon, MergeIcon, PlusIcon } from "./Icons";
import { MergeStatus } from "./MergeStatus";

interface MergeViewProps {
  tool: MergeTool;
  onBack: () => void;
}

export function MergeView({ tool, onBack }: MergeViewProps) {
  const { state, busy, blocker } = tool;
  const fileCount = state.files.length;

  return (
    <div className="merge-view">
      <div className="view-header">
        <button type="button" className="button button--ghost" onClick={onBack} disabled={busy}>
          <BackIcon /> Dashboard
        </button>
        <div>
          <h1 className="view-title">Merge PDF</h1>
          <p className="view-subtitle">
            Pages are combined in the order shown. Your original files are never changed.
          </p>
        </div>
      </div>

      <div className="panel">
        <div className="panel-toolbar">
          <span className="panel-count" aria-live="polite">
            {fileCount === 0 ? "No files selected" : `${fileCount} ${fileCount === 1 ? "file" : "files"} selected`}
          </span>
          <div className="toolbar-actions">
            {fileCount > 0 && (
              <button type="button" className="button button--ghost" onClick={tool.clear} disabled={busy}>
                Clear list
              </button>
            )}
            <button type="button" className="button button--secondary" onClick={tool.addPdfs} disabled={busy}>
              <PlusIcon /> Add PDFs
            </button>
          </div>
        </div>

        {state.notice && (
          <p className="notice" role="status">
            {state.notice}
          </p>
        )}

        {fileCount === 0 ? (
          <div className="empty-state">
            <p className="empty-title">Start by adding the PDF files you want to combine.</p>
            <p className="empty-text">You can add files in several batches, then arrange them before merging.</p>
            <button type="button" className="button button--primary" onClick={tool.addPdfs} disabled={busy}>
              <PlusIcon /> Select PDF files
            </button>
          </div>
        ) : (
          <FileList files={state.files} disabled={busy} onMove={tool.move} onRemove={tool.remove} />
        )}
      </div>

      <MergeStatus status={state.status} onCancel={tool.cancel} onDismiss={tool.dismissStatus} />

      <div className="merge-footer">
        <p className="hint" id="merge-hint">
          {blocker ?? "Ready. You will choose where to save the merged file next."}
        </p>
        <button
          type="button"
          className="button button--primary button--large"
          onClick={tool.merge}
          disabled={busy || blocker !== null}
          aria-describedby="merge-hint"
        >
          <MergeIcon /> {state.status.kind === "merging" ? "Merging…" : "Merge PDFs"}
        </button>
      </div>
    </div>
  );
}
