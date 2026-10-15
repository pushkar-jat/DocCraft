import type { ReactNode } from "react";
import { BackIcon } from "./Icons";

interface ToolLayoutProps {
  title: string;
  description: string;
  onBack: () => void;
  busy: boolean;
  children: ReactNode;
}

export function ToolLayout({ title, description, onBack, busy, children }: ToolLayoutProps) {
  return (
    <div className="tool-view">
      <div className="view-header">
        <button type="button" className="button button--ghost" onClick={onBack} disabled={busy}>
          <BackIcon /> Dashboard
        </button>
        <div>
          <h1 className="view-title">{title}</h1>
          <p className="view-subtitle">{description}</p>
        </div>
      </div>
      {children}
    </div>
  );
}

interface SingleFilePickerProps {
  label: string;
  fileName: string | null;
  detail?: string | null;
  onChoose: () => void;
  disabled: boolean;
}

/** Shows the chosen input file (name only) with a button to choose another. */
export function SingleFilePicker({ label, fileName, detail, onChoose, disabled }: SingleFilePickerProps) {
  return (
    <div className="panel">
      <div className="panel-toolbar">
        <div className="picked-file">
          <span className="panel-count">{fileName ?? "No file selected"}</span>
          {detail && <span className="picked-detail">{detail}</span>}
        </div>
        <button type="button" className={`button ${fileName ? "button--secondary" : "button--primary"}`} onClick={onChoose} disabled={disabled}>
          {fileName ? "Choose another…" : label}
        </button>
      </div>
    </div>
  );
}

export function ActionBar({ hint, children }: { hint: string; children: ReactNode }) {
  return (
    <div className="merge-footer">
      <p className="hint">{hint}</p>
      <div className="toolbar-actions">{children}</div>
    </div>
  );
}
