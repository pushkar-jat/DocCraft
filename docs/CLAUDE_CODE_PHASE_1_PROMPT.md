# Claude Code Prompt — Start Phase 1

You are working in the DocCraft repository. Read `CLAUDE.md`, `README.md`, `docs/PRODUCT_SPEC.md`, `docs/PHASE_1_ACCEPTANCE.md`, and `docs/TEST_PLAN.md` before making changes.

## First: inspect and plan

1. Inspect the current project tree, `package.json`, Tauri configuration, capability files, and installed dependency versions.
2. Confirm the project is a Tauri 2 + React + TypeScript application.
3. Check whether the working tree has uncommitted changes. Do not discard them.
4. Present a short implementation plan and list any risks or decisions that need my input.
5. Do not edit files until you have reported the plan.

## Implement only Phase 1

Create a professional, lightweight desktop dashboard for DocCraft and implement one real feature: merge two or more local PDF files into one PDF.

Required workflow:
- Native dialog selects multiple PDFs.
- Display selected filenames.
- Prevent duplicate file paths.
- Remove and reorder files.
- Require at least two files.
- Choose output path through a native save dialog.
- Merge pages in the displayed order.
- Do not modify source files or silently overwrite an input file.
- Handle canceled dialogs, invalid PDFs, encrypted/unsupported inputs, and errors gracefully.
- Show busy, success, and error states.
- Keep all document processing local; no network requests or uploads.

## Implementation constraints

- Follow the versions and conventions actually present in the generated scaffold.
- Choose the simplest maintainable PDF library for merging after checking current documentation, compatibility, and license. `pdf-lib` is a candidate.
- Use Tauri 2 APIs and least-privilege capability permissions. Inspect current official docs if plugin APIs or permission identifiers are uncertain.
- Do not give the frontend unrestricted filesystem access.
- Do not add a backend server, database, account system, telemetry, cloud sync, or AI feature.
- Do not implement compression, OCR, PDF-to-Word, Word-to-PDF, split/extract, or image-to-PDF in this phase.
- Do not leave broken buttons that pretend to work. Either omit future features or label them clearly as not yet available.
- Add automated tests for pure logic and document manual desktop tests.
- Update README setup/run/build/test instructions.
- Keep code modular and accessible. Do not replace the entire scaffold without a clear reason.

## Verification

Run the relevant checks that are available in this repository:
- package install / dependency check if needed
- frontend build
- unit tests
- Tauri development launch if possible
- Windows production build if the local toolchain permits

Do not say a command passed unless you ran it and saw success. If any check cannot be run, explain why and provide the exact command for me to run.

## Final response format

When done, report:
1. Files created/changed.
2. How the merge workflow works.
3. Commands run and exact pass/fail status.
4. Manual tests I should perform.
5. Known limitations.
6. Recommended next task after Phase 1.

Stop after Phase 1. Do not start Phase 2.
