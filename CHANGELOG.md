# Changelog

All notable changes to DocCraft are listed here. Format based on [Keep a Changelog](https://keepachangelog.com/).

## [0.2.0] — 2026-10-18: Windows 11 look and full toolkit (32 local tools)

### Changed
- The UI now follows Windows 11 (Fluent): Mica window backdrop on Windows 11, the user's Windows accent colour, Segoe UI Variable, and Fluent buttons, text fields, combo boxes, check boxes, radio buttons, info bars and scroll bars. Light/dark follow the Windows app setting. Windows 10 keeps a solid background.
- New native command `window_appearance` (no document input; allowed in the capability file).

### Fixed
- Scan to PDF: "Scan a page" is disabled when no scanner is found.

### Added
- **Organize**: Remove pages, Organize PDF (thumbnail grid: reorder, rotate, duplicate, delete, insert blank pages), **Scan to PDF** (Windows scanner via WIA, or camera capture with an optional "document mode" filter; optional OCR).
- **Optimize**: **Repair PDF** (native rebuild with lopdf, falling back to salvaging every readable page).
- **Convert to PDF**: PowerPoint, Excel and HTML to PDF through LibreOffice. HTML remote references (`http:`, `https:`, `//`, `file:`) are neutralized before conversion so nothing is fetched.
- **Convert from PDF**: PDF to JPG/PNG (chosen DPI and pages), PDF to Excel (one sheet per page, table detection from text positions), PDF to PowerPoint and PDF to PDF/A (LibreOffice).
- **Edit**: Rotate, Add page numbers (position, format, start number, page range), Add watermark (text or image, opacity, angle, centred or tiled), Crop (margins on chosen pages), **Edit PDF** (add text, images, rectangles, highlights and white-out on a page preview), **PDF Forms** (fill text, checkbox, radio and dropdown fields; optional flattening).
- **Security**: Protect (AES-256 with print/copy/edit permissions), Unlock (with the password), **Sign PDF** (drawn, typed or image signature placed on the page, plus optional PAdES B-B digital signature from a .pfx/.p12 certificate), **Redact PDF** (search terms and drawn areas; redacted pages are flattened to images so the text is truly gone), **Compare PDF** (line and word level text differences, side-by-side report).
- **Intelligence**: PDF to Markdown. AI Summarizer and Translate are listed as *Not available yet* (they would require a cloud service).
- Dashboard grouped by category.

### Security
- New native commands (`convert_document`, `protect_pdf`, `unlock_pdf`, `repair_pdf`, `certificate_info`, `sign_pdf`, `scanner_status`, `scan_page`) follow the bytes-in/bytes-out rule and are explicitly allowed in the capability file. Passwords travel percent-encoded in IPC headers and are never logged.
- The certificate's private key is only held in memory during signing.

## Phase 2: complete offline toolkit

### Added
- **Split PDF**: every N pages or custom ranges (`1-3, 5, 8-10`), one file per range, written to a chosen folder without overwriting existing files.
- **Extract pages**: selected pages in the exact order typed (e.g. `3, 1, 2`) into a new PDF.
- **Compress PDF**: three presets (Higher quality / Balanced / Smaller file) implemented natively in Rust (lopdf + image), with before/after size and percentage. Reports honestly when a file cannot shrink.
- **Images to PDF**: JPEG/PNG, reorderable, EXIF camera orientation respected, A4 / Letter / image-size pages.
- **PDF to Word** (basic layout): text, paragraphs, headings and page breaks into DOCX via pdf.js. Scanned PDFs are detected and refused with OCR guidance.
- **Word to PDF**: DOCX/DOC/ODT/RTF through a locally installed LibreOffice (detected, not bundled), using a private, hardened profile.
- **OCR / searchable PDF**: scanned PDFs or images through a locally installed Tesseract; pages rendered locally at 300 dpi.
- **Batch processing**: compress, Word to PDF, PDF to Word or OCR on many files, one at a time, with per-file status, cancel, retry and a summary.
- Engine detection with setup guidance and **Check again** when LibreOffice/Tesseract is missing.
- Generic job model with honest progress, cancellation and accessible status for every tool.
- Documentation: architecture, design, contributing, third-party notices, Phase 2 acceptance/test plan/status.

### Changed
- Merge now runs in a Web Worker; cancel terminates it instantly.
- Dashboard redesigned as a grid of nine tools.
- Native commands use raw binary IPC (bytes in, bytes out) and require explicit capability permissions (app manifest).
- Production CSP now allows `'wasm-unsafe-eval'` so pdf.js can use its bundled WebAssembly image decoders (JavaScript `eval` stays blocked).

### Fixed
- Cancelling Word to PDF could leave a temporary copy of the document behind; temp folders are now removed on every outcome.
- The dev server could reload the page mid-job when it discovered worker-only dependencies.

### Security / licensing
- pdf.js's GPL-licensed Liberation fonts are excluded from the bundle.

## [0.1.0] — Phase 1: foundation and PDF merge

### Added
- Tauri 2 + React + TypeScript desktop app with a dashboard.
- Merge two or more PDFs: native multi-file picker, de-duplication, reorder, remove, save dialog, merge in displayed order.
- Validation and clear errors for invalid, damaged, encrypted, empty and too-large inputs; output can never replace an input.
- Progress, cancellation, success and error states.
- Least-privilege capabilities (dialog-scoped file access only) and a strict production CSP.
- Unit tests for merge logic, Windows installers (MSI and NSIS).
