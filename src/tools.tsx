import type { ReactNode } from "react";
import {
  ArchiveIcon,
  BatchIcon,
  CodeIcon,
  CompareIcon,
  FormIcon,
  SheetIcon,
  SlidesIcon,
  CompressIcon,
  ConvertIcon,
  CropIcon,
  ExtractIcon,
  ImageIcon,
  LockIcon,
  MarkdownIcon,
  MergeIcon,
  NumbersIcon,
  OrganizeIcon,
  PenIcon,
  RedactIcon,
  SignIcon,
  RepairIcon,
  RemovePagesIcon,
  RotateIcon,
  ScanIcon,
  SparkleIcon,
  SplitIcon,
  TranslateIcon,
  UnlockIcon,
  WatermarkIcon,
  WordIcon,
} from "./components/Icons";

export type Category = "organize" | "optimize" | "to-pdf" | "from-pdf" | "edit" | "security" | "intelligence";

export const CATEGORIES: { id: Category; title: string }[] = [
  { id: "organize", title: "Organize PDF" },
  { id: "optimize", title: "Optimize PDF" },
  { id: "to-pdf", title: "Convert to PDF" },
  { id: "from-pdf", title: "Convert from PDF" },
  { id: "edit", title: "Edit PDF" },
  { id: "security", title: "PDF security" },
  { id: "intelligence", title: "PDF intelligence" },
];

export type ToolId =
  | "merge"
  | "split"
  | "remove-pages"
  | "extract"
  | "organize"
  | "scan"
  | "compress"
  | "ocr"
  | "batch"
  | "images-to-pdf"
  | "word-to-pdf"
  | "powerpoint-to-pdf"
  | "excel-to-pdf"
  | "html-to-pdf"
  | "pdf-to-powerpoint"
  | "pdf-to-pdfa"
  | "pdf-to-images"
  | "pdf-to-word"
  | "rotate"
  | "page-numbers"
  | "watermark"
  | "crop"
  | "pdf-to-markdown"
  | "repair"
  | "pdf-to-excel"
  | "compare"
  | "forms"
  | "edit"
  | "redact"
  | "sign"
  | "protect"
  | "unlock"
  | "ai-summarize"
  | "ai-translate";

export interface Tool {
  id: ToolId;
  category: Category;
  title: string;
  description: string;
  icon: ReactNode;
  /** Local engine the tool needs, shown on the tile. */
  engine?: "libreOffice" | "tesseract";
  /** Shown but not usable; the reason is displayed on the tile. */
  unavailable?: string;
}

const NO_AI = "Not available yet: DocCraft does not use cloud AI, and no local AI engine is supported yet.";

export const TOOLS: Tool[] = [
  { id: "merge", category: "organize", title: "Merge PDF", description: "Combine PDFs in the order you choose.", icon: <MergeIcon /> },
  { id: "split", category: "organize", title: "Split PDF", description: "One file per page range.", icon: <SplitIcon /> },
  { id: "remove-pages", category: "organize", title: "Remove pages", description: "Delete pages you don't need.", icon: <RemovePagesIcon /> },
  { id: "extract", category: "organize", title: "Extract pages", description: "Copy pages into a new PDF.", icon: <ExtractIcon /> },
  { id: "scan", category: "organize", title: "Scan to PDF", description: "From a scanner or camera.", icon: <ScanIcon /> },
  { id: "organize", category: "organize", title: "Organize PDF", description: "Reorder, rotate, duplicate, delete.", icon: <OrganizeIcon /> },

  { id: "compress", category: "optimize", title: "Compress PDF", description: "Smaller files, clear presets.", icon: <CompressIcon /> },
  { id: "ocr", category: "optimize", title: "OCR PDF", description: "Make scans searchable.", icon: <ScanIcon />, engine: "tesseract" },
  { id: "repair", category: "optimize", title: "Repair PDF", description: "Recover damaged files.", icon: <RepairIcon /> },
  { id: "batch", category: "optimize", title: "Batch processing", description: "Process many files at once.", icon: <BatchIcon /> },

  { id: "images-to-pdf", category: "to-pdf", title: "JPG to PDF", description: "JPEG and PNG images to PDF.", icon: <ImageIcon /> },
  { id: "word-to-pdf", category: "to-pdf", title: "Word to PDF", description: "DOCX, DOC, ODT, RTF.", icon: <ConvertIcon />, engine: "libreOffice" },
  { id: "powerpoint-to-pdf", category: "to-pdf", title: "PowerPoint to PDF", description: "PPTX, PPT, ODP slides.", icon: <SlidesIcon />, engine: "libreOffice" },
  { id: "excel-to-pdf", category: "to-pdf", title: "Excel to PDF", description: "XLSX, XLS, ODS sheets.", icon: <SheetIcon />, engine: "libreOffice" },
  { id: "html-to-pdf", category: "to-pdf", title: "HTML to PDF", description: "Saved web pages, offline.", icon: <CodeIcon />, engine: "libreOffice" },

  { id: "pdf-to-images", category: "from-pdf", title: "PDF to JPG", description: "Each page as an image.", icon: <ImageIcon /> },
  { id: "pdf-to-word", category: "from-pdf", title: "PDF to Word", description: "Editable DOCX (basic layout).", icon: <WordIcon /> },
  { id: "pdf-to-excel", category: "from-pdf", title: "PDF to Excel", description: "Tables to XLSX (basic).", icon: <SheetIcon /> },
  { id: "pdf-to-powerpoint", category: "from-pdf", title: "PDF to PowerPoint", description: "Pages as editable slides.", icon: <SlidesIcon />, engine: "libreOffice" },
  { id: "pdf-to-pdfa", category: "from-pdf", title: "PDF to PDF/A", description: "Archival copy (PDF/A-2b).", icon: <ArchiveIcon />, engine: "libreOffice" },

  { id: "rotate", category: "edit", title: "Rotate PDF", description: "Turn pages the right way up.", icon: <RotateIcon /> },
  { id: "page-numbers", category: "edit", title: "Add page numbers", description: "Number pages in any corner.", icon: <NumbersIcon /> },
  { id: "watermark", category: "edit", title: "Add watermark", description: "Stamp text or a logo.", icon: <WatermarkIcon /> },
  { id: "edit", category: "edit", title: "Edit PDF", description: "Add text, images, shapes.", icon: <PenIcon /> },
  { id: "forms", category: "edit", title: "PDF Forms", description: "Fill in and flatten forms.", icon: <FormIcon /> },
  { id: "crop", category: "edit", title: "Crop PDF", description: "Trim page margins.", icon: <CropIcon /> },

  { id: "unlock", category: "security", title: "Unlock PDF", description: "Remove a password you know.", icon: <UnlockIcon /> },
  { id: "protect", category: "security", title: "Protect PDF", description: "Encrypt with a password.", icon: <LockIcon /> },
  { id: "sign", category: "security", title: "Sign PDF", description: "Signature + digital certificate.", icon: <SignIcon /> },
  { id: "redact", category: "security", title: "Redact PDF", description: "Permanently remove content.", icon: <RedactIcon /> },
  { id: "compare", category: "security", title: "Compare PDF", description: "Find text differences.", icon: <CompareIcon /> },

  { id: "ai-summarize", category: "intelligence", title: "AI Summarizer", description: "Summarize a document.", icon: <SparkleIcon />, unavailable: NO_AI },
  { id: "ai-translate", category: "intelligence", title: "Translate PDF", description: "Translate a document.", icon: <TranslateIcon />, unavailable: NO_AI },
  { id: "pdf-to-markdown", category: "intelligence", title: "PDF to Markdown", description: "Headings, text and lists as .md.", icon: <MarkdownIcon /> },
];
