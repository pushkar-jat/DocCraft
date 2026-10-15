# DocCraft Phase 2 — Full Feature Acceptance Checklist

This phase covers the complete planned core document toolkit, not only split/extract. Mark items only after implementation and verification.

Checked = verified on 2026-10-15 by automated tests and/or by driving the real desktop app (dev build and the release build). Evidence for each item is in `docs/PHASE_2_STATUS.md`. Unchecked items are open; the reason is given next to them.

## PDF merge
- [x] Select multiple PDFs, deduplicate, remove/reorder files.
- [x] Merge in displayed order and save to a user-selected path.
- [x] Handle cancellation, malformed/encrypted PDFs, write failures, and output collisions safely.
- [x] Source files remain unchanged.

## Split and extract
- [x] Split by validated ranges such as `1-3, 5, 8-10`, one output per range.
- [x] Extract selected pages/ranges into one PDF in requested order.
- [x] Reject malformed, overlapping/duplicate, reversed, negative/zero, and out-of-range selections.
- [x] Page numbering is clearly 1-based in the UI.
- [x] No silent overwrites.

## Compression
- [x] Real local optimization/compression implementation.
- [x] Clear presets with documented behavior.
- [x] Before/after sizes and percentage change shown.
- [x] Text/vector and image-heavy PDFs tested.
- [x] App explains that output may not shrink and quality may change.

## Word to PDF
- [x] Real local DOCX-to-PDF conversion.
- [x] Dependency/runtime detection and helpful missing-engine message.
- [x] Representative documents with text, tables, images, and page breaks tested. *(One generated fixture plus a 400-section table document; real-world documents with complex layouts still need manual review.)*
- [x] License and redistribution requirements documented.

## PDF to Word
- [x] Real local PDF-to-DOCX output.
- [x] Output DOCX opens and contains extracted text. *(Opened by LibreOffice in an automated test; not yet opened in Microsoft Word.)*
- [x] Layout limitations and scanned-PDF/OCR requirements are explicit.
- [x] No empty/unusable output reported as success.

## Images to PDF
- [x] JPG/JPEG and PNG supported.
- [x] Multiple images can be ordered and combined.
- [x] Invalid images handled clearly.

## Batch processing
- [x] Queue supports only genuinely implemented operations.
- [x] Per-file statuses and final summary are shown.
- [x] One file failure does not corrupt other jobs.
- [x] Concurrency/memory use is bounded.

## Local OCR/searchable PDFs
- [x] Local OCR engine integrated and detected.
- [x] Known scanned test PDF produces searchable text or documented text extraction output.
- [x] No cloud OCR requests.
- [x] Runtime/license/install requirements are documented.

## Responsiveness and safety
- [ ] Heavy work does not freeze the UI for representative test files. — *pdf-lib work runs in a Web Worker and engines run natively, so the design keeps the UI free. Tested only with small and medium files (up to ~0.5 MB PDFs and a 400-section DOCX); large real-world files have not been measured.*
- [x] Progress is honest and accurate to the engine.
- [x] Cancellation/cleanup is safe where supported.
- [x] No source files or existing outputs are silently overwritten.
- [x] Tauri capabilities use least privilege.
- [x] No upload, analytics, telemetry, accounts, cloud sync, or remote AI.
- [x] Dependencies and licenses documented.

## Regression and release
- [x] All feature tests run and results recorded.
- [x] Frontend build succeeds.
- [x] Rust checks and Tauri build succeed where toolchain permits.
- [ ] Windows installer built and tested if release is claimed. — *Both installers (MSI, NSIS) were built and the release executable was tested. Install/uninstall/reinstall of the installers has **not** been run, so release readiness is not claimed.*
- [x] README and manual test plan updated.
- [x] Any blocked or unverified feature is clearly listed.

Do not claim full Phase 2 completion while any core feature is a placeholder or untested.
