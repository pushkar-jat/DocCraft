# Claude Code Prompt — DocCraft Phase 2: Complete Offline Document Toolkit

You are working in the existing DocCraft repository. Phase 2 is intended to add **all planned core document features** to the existing Phase 1 application, not just split/extract. Work incrementally, preserve existing work, and do not pretend that difficult conversions are complete when they are not.

## 1. Inspect and plan before editing

1. Read `CLAUDE.md`, `README.md`, `docs/PRODUCT_SPEC.md`, all existing acceptance criteria, and test plans.
2. Inspect the current source tree, `package.json`, `src-tauri/Cargo.toml`, Tauri configuration/capabilities, PDF merge implementation, Git status, and current tests.
3. Identify what is actually implemented and working. Do not infer completion from documentation.
4. Run existing checks and report baseline results.
5. Present a feature-by-feature implementation plan with dependencies, licensing risks, expected limitations, and an order of delivery. Do not edit files until you present the plan.
6. Do not discard or overwrite user changes. Do not recreate the project or rewrite the whole app.

If the current Windows/MSVC build is blocked, continue with source-level work and tests that can run, but report the blocker and do not claim a Windows build passed.

## 2. Product objective

Build DocCraft as a lightweight, offline-first desktop toolkit for everyday PDF/document tasks. Windows x64 is the first release target; keep architecture portable to macOS and Linux.

All core document processing must happen locally. Do not add accounts, telemetry, analytics, uploads, cloud sync, remote conversion APIs, or remote AI.

## 3. Features included in this expanded Phase 2

Implement the following features in a cohesive dashboard. Use a phased internal sequence, but this entire feature set is the Phase 2 scope. Do not stop after split/extract.

### A. PDF merge
- Preserve and harden the existing merge feature.
- Select multiple PDFs, deduplicate inputs, reorder them, remove selected files, merge in displayed order, choose output path.
- Validate inputs and handle cancel, malformed/encrypted PDFs, write failures, and output collisions safely.

### B. Split PDF and extract pages
- Split by page ranges such as `1-3, 5, 8-10`, with one output per range.
- Extract chosen pages/ranges into one output PDF in requested order.
- Page numbers in UI are 1-based.
- Use a dedicated tested parser. Reject empty/malformed tokens, zero/negative values, reversed ranges, out-of-range pages, and overlaps/duplicates with clear messages.
- Never modify the source or silently overwrite existing outputs.

### C. Compress / optimize PDF
- Provide understandable presets such as **Smaller file**, **Balanced**, and **Higher quality**, only if they map to real behavior.
- Show input and output file sizes and percentage change.
- Explain that some PDFs may not shrink, and recompressing images can reduce quality.
- Do not claim compression is available unless a real implementation exists.
- Evaluate library/engine options, compatibility, platform support, maintenance, and licenses. Use a reliable local approach; do not send files to a website or remote service.
- Test both image-heavy and text/vector PDFs. If a selected engine cannot provide a feature, state that rather than faking it.

### D. Word to PDF
- Convert DOCX to PDF entirely locally.
- Investigate an available local conversion engine, such as LibreOffice headless mode, and decide whether to use a detected system installation or bundle a supported engine. Do not silently assume LibreOffice is installed.
- Document setup/runtime requirements and formatting limitations.
- Preserve page layout, fonts, tables, images, and page breaks as well as the chosen engine supports.
- Do not shell out using unsanitized user input. Use safe process APIs and argument arrays, timeouts, and error handling if invoking an external engine.
- Check licensing and redistribution implications before bundling.

### E. PDF to Word (DOCX)
- Convert text-based PDFs into editable DOCX locally.
- Evaluate layout and extraction libraries and be honest about limitations. PDFs do not necessarily contain semantic paragraphs/tables; perfect fidelity cannot be guaranteed.
- Handle scanned PDFs as a distinct case and explain when OCR is needed.
- Preserve extracted text and images as well as feasible, and avoid silently creating an empty or unusable DOCX.
- If reliable full conversion is not feasible in the current scope, implement a tested MVP for text extraction to DOCX with an explicit **basic layout** label and document unsupported layouts. Do not mark advanced conversion complete.

### F. Images to PDF
- Support common image types such as JPG/JPEG and PNG.
- Allow multiple images, reordering, and output to a single PDF.
- Respect image orientation where feasible and avoid unnecessarily huge memory copies.
- Validate invalid image files and report useful errors.

### G. Batch processing
- Provide a queue for multiple files for supported operations.
- Show per-file status (queued, processing, succeeded, failed, canceled), and a final summary.
- Avoid unbounded parallelism or exhausting memory on large files.
- Allow removal of queued items and safe retry of failures where feasible.
- Do not expose batch options for features that are not actually implemented.

### H. Local OCR and searchable PDFs
- Evaluate a local OCR engine (for example Tesseract) and its platform/runtime/license implications.
- Add OCR to produce searchable PDFs or extract text from scanned documents, depending on the engine's capabilities.
- Clearly distinguish selectable text PDFs from image-only scans.
- If OCR requires an external local install or a sizable bundled runtime, make that requirement visible and provide a clear readiness check.
- Do not call cloud OCR APIs. Do not claim OCR works until a real local test passes.
- If the OCR engine cannot be integrated safely in this delivery, implement the UI/runtime capability detection and report the feature as blocked/incomplete—not complete.

## 4. Background processing, progress, and cancellation

- Heavy work must not freeze the UI. Inspect the current implementation and choose the appropriate strategy: Web Worker for CPU-heavy JavaScript work or a background native/Rust task for native processing/external engine jobs.
- Avoid unbounded concurrent processing; set a sensible queue/concurrency limit.
- Provide progress when the engine can measure it. Do not invent precise percentages.
- Support cancellation where safely possible. Do not report partial output as successful. Clean up temporary files on failure/cancellation.
- Use safe temp directories and predictable cleanup behavior.

## 5. UX and product requirements

- A coherent dashboard with clear entry points for Merge, Split, Extract, Compress, Word to PDF, PDF to Word, Images to PDF, Batch, and OCR/searchable PDF.
- Each feature must either work or be visibly marked **Not available yet** with a reason. Never show a fake enabled button.
- Use native file-open/save dialogs where appropriate.
- Show selected input names, page counts/sizes when available, output destination, processing state, and useful errors.
- Accessibility: keyboard-operable controls, meaningful labels, visible focus, and status messages.
- Use a consistent design and avoid a separate disconnected UI for each tool.
- Do not require login or internet for core operations.

## 6. Security, privacy, licensing, and reliability

- Use Tauri 2 APIs and least-privilege capabilities; never grant unrestricted filesystem access just to simplify implementation.
- Use user-selected file access and native dialogs where practical.
- Treat all files as untrusted input. Handle corrupt, malformed, encrypted, huge, and unsupported files safely.
- Do not silently overwrite source or existing output files.
- Do not execute shell commands with interpolated user-controlled paths. If a local converter must be invoked, use a safe process API with explicit arguments and controlled temp paths.
- No network requests for document contents; no telemetry, analytics, accounts, cloud sync, or remote AI.
- Review all third-party library/engine licenses and distribution requirements. Record them in `docs/THIRD_PARTY_NOTICES.md` or a comparable file.
- Do not bundle redistributables or external engines unless the license and distribution terms permit it.
- Keep Windows as the initial target while documenting macOS/Linux implications.
- Do not claim perfect PDF/Word fidelity or universal compression.

## 7. Implementation strategy

After the inspection report, implement in small, reviewable increments in this suggested order:
1. Harden and test merge.
2. Add page-range parser, split, and extract.
3. Add image-to-PDF.
4. Add compression/optimization with tested presets and before/after sizes.
5. Add local Word-to-PDF engine integration and dependency detection.
6. Add PDF-to-DOCX MVP with honest fidelity limits.
7. Add local OCR/searchable-PDF workflow if an appropriate engine can be integrated and tested.
8. Add batch queue and unify job/progress/error handling.
9. Polish dashboard, accessibility, documentation, and release checks.

Do not stop after one item and call Phase 2 complete. Keep a clear checklist and report partial completion if a feature is blocked.

## 8. Testing and verification

Add automated tests for pure logic and operation-level behavior, including:
- Page-range parsing: single page, ranges, whitespace, invalid syntax, zero/negative, reversed ranges, out-of-range, overlaps.
- Merge page order and output page count.
- Split output count/page order.
- Extract output page order.
- Image-to-PDF page count and image validation.
- Compression output validity and before/after sizes; allow for cases where the output is larger.
- DOCX-to-PDF output opens and has expected page/text content for representative fixtures.
- PDF-to-DOCX extracted text and output document validity.
- OCR with a known scanned fixture and expected searchable text.
- Batch success/failure isolation and status summaries.
- Output collision and source-preservation checks.
- Cancellation/cleanup behavior where architecture permits.
- Regression of every existing feature.

Run actual frontend build, tests, Rust checks, and Tauri build if the local toolchain permits. Do not claim checks passed unless run successfully. If blocked, provide the exact command and blocker.

## 9. Definition of done and final report

Update `README.md`, product spec, acceptance criteria, test plan, setup notes, and third-party notices.

The final report must include:
1. Feature-by-feature status: Implemented and tested / Implemented but not fully verified / Blocked / Not implemented.
2. Files created/changed.
3. Chosen libraries/engines, reasons, and license notes.
4. External local runtime requirements (LibreOffice/Tesseract/etc.) and how the app detects missing dependencies.
5. Exact commands run and pass/fail results.
6. Manual tests still required.
7. Known limitations for compression and PDF/Word fidelity.
8. Confirmation that core processing remains offline.
9. Whether the Windows installer was actually built and tested.

Do not call the whole Phase 2 complete while any required feature remains merely a placeholder. If the full scope is too large for one session, implement and verify the highest-priority subset, keep the checklist honest, and continue in later sessions without rewriting working code.
