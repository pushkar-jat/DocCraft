# DocCraft

**Status:** Phase 1 implemented; desktop build pending verification (see `docs/PHASE_1_STATUS.md`)
**Working name:** DocCraft (not yet checked for trademark or naming conflicts)
**Initial platform:** Windows x64 · **Future platforms:** macOS and Linux
**Product direction:** Lightweight, offline-first desktop document tools.

DocCraft is a Tauri 2 + React + TypeScript desktop app. Phase 1 has one real feature: **merge two or more local PDF files into a new PDF**. Documents are processed on your computer and are never uploaded. There is no account, telemetry, analytics or cloud sync.

## Features (Phase 1)

- Dashboard with a Merge PDF tool. Later tools are listed as "Not available yet" and are not clickable.
- Native multi-file picker restricted to `.pdf`. Files can be added in several batches.
- Readable file list; duplicates are skipped with a notice; move up/down and remove buttons.
- Merge is disabled with an explanation until at least two PDFs are selected.
- Native save dialog for the output (suggests `merged.pdf` next to the first input).
- Pages are merged in the displayed order; source files are only read, never written.
- Refuses to write over any of the input files; Windows asks before replacing any other existing file.
- Progress (reading → merging → writing), Cancel, success and error messages with accessible live regions.
- Helpful errors for non-PDF, damaged, truncated, encrypted, page-less, unreadable or too-large inputs, and for failed writes.

Not in Phase 1: split/extract, compression, images-to-PDF, PDF↔Word, OCR, batch jobs.

## Prerequisites

- Windows 10/11, 64-bit
- Git
- Node.js LTS and npm
- Rust stable MSVC toolchain (`rustup default stable-msvc`)
- **Microsoft C++ Build Tools** with *Desktop development with C++* (required to compile Rust on Windows)
- Microsoft Edge WebView2 Runtime (preinstalled on most systems)

Step-by-step instructions: `docs/SETUP_WINDOWS.md`.

## Setup

```powershell
cd "D:\Work Profile\Projects\DocCraft"   # or wherever you cloned it
npm install
```

## Run, test, build

| Task | Command | Notes |
|---|---|---|
| Unit tests | `npm test` | Vitest; pure logic and the real pdf-lib merge, no window needed |
| Tests in watch mode | `npm run test:watch` | |
| Type-check + frontend build | `npm run build` | Output in `dist/` |
| Launch the desktop app (dev) | `npm run tauri dev` | First run compiles Rust and takes several minutes |
| Windows production build | `npm run tauri build` | Installers in `src-tauri/target/release/bundle/` (`msi/` and `nsis/`) |

Manual desktop tests: `docs/TEST_PLAN.md`. Record the results in `docs/PHASE_1_STATUS.md`.

## How it works

```
Dashboard ─► Merge view
  Add PDFs ──► dialog.open (multiple, *.pdf) ──► selected paths (deduplicated, reorderable)
  Merge PDFs ─► dialog.save ──► validate output ≠ any input, ends in .pdf
              ─► for each file: fs.stat (size cap) + fs.readFile
              ─► pdf-lib: check header, load, reject encrypted/empty, copy pages in order
              ─► fs.writeFile(output)  (only if everything succeeded and not cancelled)
```

Project layout:

```
src/
  App.tsx, App.css            app shell and styles (light/dark, system fonts only)
  components/                 Dashboard, MergeView, FileList, MergeStatus, Icons
  state/mergeState.ts         pure reducer for the merge screen (tested)
  state/useMergeTool.ts       React hook wiring dialogs, workflow, cancel
  lib/paths.ts                filename extraction, path comparison (tested)
  lib/selection.ts            add/dedupe/remove/move, validation (tested)
  lib/merge.ts                pdf-lib merge core with cancellation (tested)
  lib/workflow.ts             read → merge → write orchestration (tested with a fake fs)
  services/tauriFiles.ts      the only module that touches Tauri dialog/fs APIs
src-tauri/
  capabilities/default.json   least-privilege permissions
  tauri.conf.json             window, CSP, bundle config
docs/                         spec, acceptance criteria, test plan, status, dependencies
```

## Security and privacy model

- **No network:** no network code is used. The production CSP restricts connections to the app itself and Tauri IPC (`connect-src 'self' ipc: http://ipc.localhost`), and loads no remote scripts, fonts or images.
- **Least-privilege file access:** the main window may only use `dialog:allow-open`, `dialog:allow-save`, `fs:allow-read-file`, `fs:allow-write-file` and `fs:allow-stat`, with **no static filesystem scope**. The dialog plugin adds each file the user picks to the scope at runtime, so the UI can only read the PDFs the user chose and write the file the user named. This was verified against the plugin source (tauri-plugin-dialog 2.8.3, tauri-plugin-fs 2.7.1).
- **No custom Rust commands** and no shell execution.
- **Untrusted input:** file contents are checked for a PDF header and parsed defensively; extensions are only a usability filter.
- **No sensitive logging:** error messages name files by file name only, never by full path.

## Dependencies and licenses

See `docs/DEPENDENCIES.md`, including why `pdf-lib` 1.17.1 was chosen and pinned. DocCraft itself has no license chosen yet.

## Source-of-truth documents

- `CLAUDE.md`: coding-agent instructions
- `docs/PRODUCT_SPEC.md`: product principles and roadmap
- `docs/PHASE_1_ACCEPTANCE.md`: definition of done
- `docs/PHASE_1_STATUS.md`: current verification status and known limitations
- `docs/TEST_PLAN.md`: manual and automated tests
- `docs/SETUP_WINDOWS.md`: Windows setup
- `docs/CLAUDE_CODE_PHASE_1_PROMPT.md`: the original Phase 1 prompt

## Safety and quality rules

- Do not run commands that delete files or rewrite large areas without explaining the effect and asking for approval.
- Do not enable broad filesystem permissions just to make a demo work.
- Use least-privilege Tauri capabilities.
- Do not silently overwrite input files.
- Never claim a test/build passed unless the command was actually run and succeeded.
- Keep dependencies and their licenses documented before packaging or distributing the app.
- Do not copy proprietary code or branding from another product.
