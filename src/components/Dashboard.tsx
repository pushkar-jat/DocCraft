import type { ReactNode } from "react";
import { CompressIcon, ConvertIcon, ImageIcon, LockIcon, MergeIcon, ScanIcon, SplitIcon } from "./Icons";

interface PlannedTool {
  title: string;
  description: string;
  icon: ReactNode;
}

// Shown only so users know what is coming. These are not buttons and do nothing.
const PLANNED_TOOLS: PlannedTool[] = [
  { title: "Split & extract pages", description: "Pull out page ranges into new PDFs.", icon: <SplitIcon /> },
  { title: "Compress PDF", description: "Reduce file size with quality controls.", icon: <CompressIcon /> },
  { title: "Images to PDF", description: "Combine images into one PDF.", icon: <ImageIcon /> },
  { title: "Word ↔ PDF", description: "Convert between DOCX and PDF locally.", icon: <ConvertIcon /> },
  { title: "OCR", description: "Make scanned PDFs searchable.", icon: <ScanIcon /> },
];

interface DashboardProps {
  onOpenMerge: () => void;
  selectedCount: number;
}

export function Dashboard({ onOpenMerge, selectedCount }: DashboardProps) {
  return (
    <div className="dashboard">
      <section className="hero" aria-labelledby="hero-title">
        <h1 id="hero-title">Your PDF tools, on your computer</h1>
        <p className="hero-text">
          DocCraft works offline. Your documents are processed on this device and are never uploaded.
        </p>
        <p className="privacy-pill">
          <LockIcon width={16} height={16} /> Local processing · No account · No tracking
        </p>
      </section>

      <section aria-labelledby="tools-title">
        <h2 id="tools-title" className="section-title">
          Available tools
        </h2>
        <button type="button" className="tool-card tool-card--active" onClick={onOpenMerge}>
          <span className="tool-icon">
            <MergeIcon width={26} height={26} />
          </span>
          <span className="tool-body">
            <span className="tool-title">Merge PDF</span>
            <span className="tool-description">
              Combine two or more PDF files into one document, in the order you choose.
            </span>
          </span>
          <span className="tool-cta">{selectedCount > 0 ? `Continue (${selectedCount} selected)` : "Open"}</span>
        </button>
      </section>

      <section aria-labelledby="planned-title">
        <h2 id="planned-title" className="section-title">
          Planned for later versions
        </h2>
        <ul className="planned-grid">
          {PLANNED_TOOLS.map((tool) => (
            <li key={tool.title} className="planned-card" aria-label={`${tool.title} — not available yet`}>
              <span className="tool-icon tool-icon--muted">{tool.icon}</span>
              <span className="tool-body">
                <span className="tool-title">{tool.title}</span>
                <span className="tool-description">{tool.description}</span>
              </span>
              <span className="badge">Not available yet</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
