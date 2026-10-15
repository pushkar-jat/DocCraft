# Phase 1 — Acceptance Criteria

## Scope

A Windows desktop application built with Tauri 2, React, and TypeScript. It must provide a real, local PDF merge workflow.

## Functional acceptance

- [ ] App opens as a native desktop window.
- [ ] Dashboard clearly identifies the app and the PDF merge workflow.
- [ ] User can select multiple PDF files using a native file dialog.
- [ ] Canceling the file dialog does not crash or corrupt state.
- [ ] Selected files are listed by readable filename.
- [ ] Duplicate paths are not added twice.
- [ ] User can remove a selected file.
- [ ] User can reorder selected files.
- [ ] Merge is disabled or gives a clear validation message when fewer than two PDFs are selected.
- [ ] User chooses the output path through a save dialog.
- [ ] Canceling the save dialog does not create an output file.
- [ ] Output page order follows the displayed input order.
- [ ] Input files are not modified.
- [ ] Output is a valid PDF that opens in a standard PDF reader.
- [ ] Invalid, malformed, encrypted, or unsupported input results in a helpful error instead of an unhandled crash.
- [ ] Busy state prevents accidental repeated merge submissions.
- [ ] Success and failure status is visible and accessible.

## Privacy/security acceptance

- [ ] No document upload or remote processing.
- [ ] No analytics or telemetry.
- [ ] No unrestricted filesystem permissions granted to the frontend.
- [ ] Tauri capabilities follow least privilege and match actual functionality.
- [ ] Output does not silently overwrite an input file.
- [ ] Dependencies and their licenses are documented for review.

## Engineering acceptance

- [ ] Frontend production build succeeds.
- [ ] Rust/Tauri build succeeds on the developer's Windows system.
- [ ] Automated tests exist for pure logic that can be tested without launching a desktop window.
- [ ] Manual test plan is documented and run.
- [ ] README includes setup, run, test, and build commands.
- [ ] Any uncompleted criteria are reported honestly.

## Out of scope

PDF-to-Word, Word-to-PDF, compression, OCR, split/extract, images-to-PDF, accounts, sync, cloud services, and AI features.

> Current verification status for each item is tracked in `docs/PHASE_1_STATUS.md`.
