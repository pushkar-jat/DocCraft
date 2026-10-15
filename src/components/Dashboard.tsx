import type { ReactNode } from "react";
import { useEngines } from "../state/EnginesContext";
import {
  BatchIcon,
  CompressIcon,
  ConvertIcon,
  ExtractIcon,
  ImageIcon,
  LockIcon,
  MergeIcon,
  ScanIcon,
  SplitIcon,
  WordIcon,
} from "./Icons";

export type ToolId = "merge" | "split" | "extract" | "compress" | "word-to-pdf" | "pdf-to-word" | "images-to-pdf" | "ocr" | "batch";

interface Tool {
  id: ToolId;
  title: string;
  description: string;
  icon: ReactNode;
  engine?: "libreOffice" | "tesseract";
}

const TOOLS: Tool[] = [
  { id: "merge", title: "Merge PDF", description: "Combine PDFs into one, in the order you choose.", icon: <MergeIcon /> },
  { id: "split", title: "Split PDF", description: "Split a PDF into several files by page ranges.", icon: <SplitIcon /> },
  { id: "extract", title: "Extract pages", description: "Copy selected pages into a new PDF.", icon: <ExtractIcon /> },
  { id: "compress", title: "Compress PDF", description: "Reduce file size with clear quality presets.", icon: <CompressIcon /> },
  { id: "images-to-pdf", title: "Images to PDF", description: "Turn JPEG and PNG images into one PDF.", icon: <ImageIcon /> },
  { id: "pdf-to-word", title: "PDF to Word", description: "Editable DOCX from a text PDF (basic layout).", icon: <WordIcon /> },
  { id: "word-to-pdf", title: "Word to PDF", description: "DOCX, DOC, ODT or RTF to PDF.", icon: <ConvertIcon />, engine: "libreOffice" },
  { id: "ocr", title: "OCR / searchable PDF", description: "Recognize text in scans and images.", icon: <ScanIcon />, engine: "tesseract" },
  { id: "batch", title: "Batch processing", description: "Compress or convert many files in one go.", icon: <BatchIcon /> },
];

const ENGINE_NAMES = { libreOffice: "LibreOffice", tesseract: "Tesseract" } as const;

interface DashboardProps {
  onOpen: (tool: ToolId) => void;
  mergeCount: number;
}

export function Dashboard({ onOpen, mergeCount }: DashboardProps) {
  const { status, checking } = useEngines();

  return (
    <div className="dashboard">
      <section className="hero" aria-labelledby="hero-title">
        <h1 id="hero-title">Your PDF tools, on your computer</h1>
        <p className="hero-text">DocCraft works offline. Your documents are processed on this device and are never uploaded.</p>
        <p className="privacy-pill">
          <LockIcon width={16} height={16} /> Local processing · No account · No tracking
        </p>
      </section>

      <section aria-labelledby="tools-title">
        <h2 id="tools-title" className="section-title">
          Tools
        </h2>
        <ul className="tool-grid">
          {TOOLS.map((tool) => {
            const missing = tool.engine !== undefined && !checking && !(status?.[tool.engine].available ?? false);
            return (
              <li key={tool.id}>
                <button type="button" className="tool-tile" onClick={() => onOpen(tool.id)}>
                  <span className="tool-icon">{tool.icon}</span>
                  <span className="tool-body">
                    <span className="tool-title">
                      {tool.title}
                      {tool.id === "merge" && mergeCount > 0 && <span className="badge badge--accent">{mergeCount} selected</span>}
                    </span>
                    <span className="tool-description">{tool.description}</span>
                    {tool.engine && (
                      <span className={`engine-tag ${missing ? "engine-tag--missing" : ""}`}>
                        {missing ? `Needs ${ENGINE_NAMES[tool.engine]} (not found) — open for setup` : `Uses ${ENGINE_NAMES[tool.engine]} on this computer`}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
