# Product Specification

## Product summary

DocCraft is a proposed lightweight desktop application for everyday PDF and document tasks. The product aims to offer the convenience of online PDF utility websites while keeping core document processing on the user's own device.

The name is provisional. Do not assume it is available as a trademark or that the project is affiliated with ArtCraft.

## Target users

People who frequently merge, convert, compress, or organize documents and prefer not to upload confidential files to online services.

## Product principles

1. **Local-first:** process documents on the user's machine.
2. **Privacy by default:** no account, uploads, telemetry, analytics, or cloud sync in the MVP.
3. **Clear behavior:** explain unsupported, encrypted, malformed, or failed inputs.
4. **Small and focused:** prioritize everyday workflows over a full office suite.
5. **Cross-platform direction:** Windows first; avoid unnecessary Windows-only business logic.
6. **Honest capability claims:** only advertise implemented and tested features as available.

## Roadmap

> **Scope change (2026-10-15):** Phase 2 was expanded by the product owner to the complete core toolkit: merge hardening, split/extract, compression, Word ↔ PDF, images to PDF, batch processing and local OCR (see `docs/CLAUDE_CODE_PHASE_2_PROMPT.md`). The original phases 2–5 below are kept for reference; their core features are now implemented, and `docs/PHASE_2_STATUS.md` tracks what is verified. Remaining roadmap items are the "Later" list at the end.

### Phase 1 — Foundation and PDF merge
- Desktop shell and project structure.
- Basic dashboard and native file selection.
- Select, reorder, and remove PDFs.
- Merge selected PDFs into a new output file.
- Error handling, basic tests, Windows build verification.

### Phase 2 — PDF basics
- Split PDF and extract page ranges.
- Rotate pages, if supported reliably by selected library.
- Improve progress and large-file behavior.

### Phase 3 — Compression and images
- PDF optimization/compression with quality controls.
- Images to PDF.
- Compare output size and quality; avoid promising that every PDF can always be reduced.

### Phase 4 — Word interoperability
- Word to PDF using a locally executed conversion engine.
- PDF to DOCX with explicit limitations around layout fidelity.
- Evaluate fonts, tables, scanned pages, and document rendering.
- Check all licensing and redistribution requirements before bundling any engine.

### Phase 5 — OCR and batch workflows
- Local OCR and searchable PDFs.
- Batch processing and job summaries.
- Performance, accessibility, localization, installer polish.

### Later (not yet implemented)
- Rotate pages; page thumbnails and visual page picking.
- PDF to Word with images, tables and multi-column layout.
- Password-protected PDF support (prompt for a password and decrypt locally).
- Optional bundled engines (Tesseract, possibly LibreOffice) for a single-download install.
- Localization, installer polish, signed releases, macOS/Linux builds.

## Non-goals for MVP

- Web app or server backend.
- User accounts.
- Cloud storage or synchronization.
- Uploading files to external services.
- Online AI processing.
- Full replacement for Microsoft Word or Adobe Acrobat.
- Guaranteed perfect PDF-to-Word layout preservation.
