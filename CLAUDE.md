# DocCraft — Claude Code Instructions

## Mission

Build DocCraft, a lightweight, privacy-first, offline-first desktop document utility. Windows x64 is the first target; keep the architecture portable to macOS and Linux.

## Stack

- Tauri 2 for the desktop shell.
- React and TypeScript for the UI.
- Rust for native integrations where appropriate.
- `npm` for frontend package management.
- A PDF library selected after checking current maintenance, compatibility, security posture, and license. `pdf-lib` is a candidate for the first merge implementation, not a mandatory choice if a verified issue makes it unsuitable.

## Phase 1 only

Implement a runnable desktop application and a real PDF merge workflow:
1. Dashboard with a clear Merge PDF action.
2. Native multi-file picker restricted to PDFs.
3. List selected files, deduplicate paths, remove files, and reorder files.
4. Require at least two PDFs to merge.
5. Native save dialog for the output.
6. Merge pages in the displayed order.
7. Do not modify source files or silently overwrite an input.
8. Provide useful validation, progress/busy, cancellation, success, and failure states.
9. Add tests where practical and document manual verification.

Do not implement PDF-to-Word, Word-to-PDF, compression, OCR, split/extract, accounts, telemetry, analytics, cloud sync, network upload, or AI features in Phase 1. Mark unimplemented UI features as future work only if showing them is helpful; never make them look functional.

## Working method

- First inspect the repository, `package.json`, Tauri config, capability files, and installed versions.
- Before editing, present a short plan and identify any assumptions.
- Work in small increments. Do not overwrite project files blindly.
- Follow the installed Tauri 2 APIs and official documentation for the versions in this repository; do not assume older examples still apply.
- Use the actual package scripts from `package.json`.
- After each meaningful change, run relevant checks and report the exact commands and results.
- If a command fails, investigate and fix the root cause rather than hiding the failure.
- If a tool, build requirement, permission, or platform behavior cannot be verified, say so explicitly.

## Security and privacy

- Core document operations must be local. Do not add network requests, analytics, telemetry, remote AI, accounts, or cloud storage.
- Apply least-privilege Tauri capabilities. Do not grant unrestricted filesystem access to the frontend.
- Use native file dialogs and restrict access to user-selected input/output files where possible.
- Validate file extensions for user experience, but do not treat extensions as proof that a file is a valid PDF.
- Handle malformed, encrypted, unsupported, or unusually large files gracefully.
- Never log document contents or sensitive local paths unnecessarily.
- Do not silently overwrite source documents. Ask for a distinct output path or confirm a deliberate overwrite safely.
- Treat files as untrusted input. Avoid shelling out with user-controlled paths or command strings.

## Engineering quality

- TypeScript strictness should remain enabled unless the generated template requires a documented exception.
- Prefer small, understandable components and functions.
- Keep UI state explicit and accessible; buttons need labels, disabled states, and visible error/success messages.
- Avoid unnecessary dependencies.
- Add tests for merge ordering, insufficient input files, duplicate selections, cancellation, and failure handling where architecture permits.
- Document third-party dependencies and licenses before distribution.
- Do not use a product name, logo, or assets in a way that implies official ArtCraft affiliation. DocCraft is a provisional internal name.

## Definition of done for Phase 1

Follow `docs/PHASE_1_ACCEPTANCE.md` and `docs/TEST_PLAN.md`. Do not claim completion unless the acceptance criteria are checked or the remaining gaps are explicitly listed.

## Project notes (Phase 1 implementation)

- Merge runs in the webview with `pdf-lib` (pinned exactly). See `docs/DEPENDENCIES.md` for why.
- Pure logic lives in `src/lib/` and `src/state/mergeState.ts` and is unit-tested with Vitest (`npm test`).
- All file I/O goes through `src/services/tauriFiles.ts`. The capability grants no static fs scope; the dialog plugin adds each user-selected file to the scope at runtime.
- `pdf-lib` is compiled to ES5, so `instanceof` checks against its error classes do not work. Inspect document state (e.g. `isEncrypted`) instead.
- Current status and gaps: `docs/PHASE_1_STATUS.md`.
