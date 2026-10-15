# Phase 1 — Status and Verification Report

Date: 2026-10-15 · Machine: Windows 11 Pro 22621 x64 · Node 24.13.0 · npm 11.12.0 · Rust 1.99.0 (stable-x86_64-pc-windows-msvc)

**Phase 1 is not yet complete.** The code is implemented and its automated tests pass, but the desktop app has not been compiled or launched. This machine has no Microsoft C++ Build Tools (`link.exe` / Windows SDK), so every Rust build fails at the link step. All manual tests are therefore **Not run**.

## Commands run

| Command | Result |
|---|---|
| `npm install` | Pass. 0 vulnerabilities |
| `npm test` (`vitest run`) | **Pass**. 5 files, 62 tests |
| `npm run build` (`tsc && vite build`) | **Pass**. Main chunk 242 kB, lazily loaded merge chunk 422 kB |
| `cargo fetch` (src-tauri) | Pass. Crates downloaded, used to verify plugin permission IDs and scope behaviour from source |
| `cargo check` (src-tauri) | **Fail** (environment): `linking with link.exe failed … you may need to install Visual Studio build tools with the "C++ build tools" workload` |
| `npm run tauri dev` | **Not run**. Blocked by the same missing linker |
| `npm run tauri build` | **Not run**. Blocked by the same missing linker |

To unblock, install the Build Tools (see `docs/SETUP_WINDOWS.md` step 3), reopen the terminal and run:

```powershell
npm run tauri dev
npm run tauri build
```

## Acceptance criteria status

Legend: ✅ verified by automated test or inspection · 🟡 implemented, needs the manual desktop test · ❌ not met / blocked

### Functional
| Criterion | Status | Evidence |
|---|---|---|
| App opens as a native desktop window | ❌ blocked | Requires Rust build |
| Dashboard identifies the app and merge workflow | 🟡 | `src/components/Dashboard.tsx` |
| Native multi-file PDF dialog | 🟡 | `pickPdfFiles()` in `src/services/tauriFiles.ts` |
| Cancelling file dialog is safe | ✅ logic / 🟡 desktop | `mergeState.test.ts`, `selection.test.ts` |
| Files listed by readable name | ✅ logic / 🟡 desktop | `paths.test.ts` |
| Duplicates not added twice | ✅ | `selection.test.ts` |
| Remove a file | ✅ logic / 🟡 desktop | `selection.test.ts` |
| Reorder files | ✅ logic / 🟡 desktop | `selection.test.ts` |
| Merge disabled with < 2 files, with a message | ✅ logic / 🟡 desktop | `mergeBlocker`; button disabled + hint |
| Output chosen via save dialog | 🟡 | `pickOutputPath()` |
| Cancelling save dialog creates no output | ✅ logic / 🟡 desktop | Workflow never starts on `null` path |
| Output order follows displayed order | ✅ | `merge.test.ts`, `workflow.test.ts` |
| Inputs not modified | ✅ logic / 🟡 desktop | Inputs only read; buffers unchanged in tests |
| Output is a valid PDF | ✅ reload by pdf-lib / 🟡 external reader | `merge.test.ts` |
| Invalid / malformed / encrypted / empty input → helpful error | ✅ | `merge.test.ts`, `workflow.test.ts` |
| Busy state prevents repeat submission | ✅ logic / 🟡 desktop | `isBusy`, `busyRef` guard |
| Success/failure visible and accessible | 🟡 | `role="status"` / `role="alert"` regions |

### Privacy / security
| Criterion | Status | Evidence |
|---|---|---|
| No upload / remote processing | ✅ inspection | No network code; bundle scanned; CSP `connect-src 'self' ipc:` |
| No analytics / telemetry | ✅ inspection | None added |
| No unrestricted fs access | ✅ inspection | `capabilities/default.json`: no fs scope; plugin source checked |
| Least-privilege capabilities | ✅ inspection | Only `dialog:allow-open/save`, `fs:allow-read-file/write-file/stat`; opener plugin removed |
| No silent overwrite of an input | ✅ | `validateOutputPath` + `workflow.test.ts`; Windows also prompts before replacing any existing file (🟡 confirm manually) |
| Dependencies and licenses documented | ✅ | `docs/DEPENDENCIES.md` |

### Engineering
| Criterion | Status |
|---|---|
| Frontend production build succeeds | ✅ |
| Rust/Tauri build succeeds | ❌ blocked (missing MSVC Build Tools) |
| Automated tests for pure logic | ✅ 62 tests |
| Manual test plan documented **and run** | 🟡 documented in `docs/TEST_PLAN.md`; **not run** |
| README has setup/run/test/build commands | ✅ |
| Gaps reported honestly | ✅ this file |

## Manual test record (docs/TEST_PLAN.md)

All 23 manual tests: **Not run**. The desktop app could not be built on this machine. Record results here when you run them:

| # | Test | Result | Notes |
|---|---|---|---|
| 1–23 | See `docs/TEST_PLAN.md` | Not run | |

## Known limitations

- Merging runs on the webview's main thread with pdf-lib. The UI yields between files so Cancel stays responsive, but one very large file can freeze the window while it is parsed. Total input is capped at 1 GiB.
- Cancel works until writing starts; the write itself is not interruptible.
- Encrypted PDFs (including ones that open without a password) are rejected; there is no password prompt.
- Interactive forms, bookmarks/outlines, document-level JavaScript and metadata from the inputs are not carried into the output. Pages, their content and annotations are.
- Paths are compared case-insensitively on every platform, so on Linux `A.pdf` and `a.pdf` in the same folder would be treated as the same file. This is a safe failure.
- No drag-and-drop: files dropped on the window are ignored, because they would not pass the fs scope.
- Default Tauri dev CSP is relaxed (`devCsp: null`); the strict CSP applies to production builds.
- The product name and icon are provisional and not trademark-checked.
