# Contributing to DocCraft

Thanks for helping! DocCraft is a privacy-first desktop app, so a few rules are stricter than usual. Please read them before opening a pull request.

## Ground rules

1. **Everything stays local.** No network requests, telemetry, analytics, accounts, cloud services or remote AI. PRs that add any of these will not be merged.
2. **Least privilege.** Never add a static filesystem scope or broad permissions. File access goes through native dialogs (`src/services/tauriFiles.ts`). Rust commands take bytes, not paths.
3. **Honest features.** Do not add a button for something that does not work yet. Show limits in the UI, next to the action.
4. **Originals are never modified or silently overwritten.**
5. **No shell commands** built from user input. External programs run via `src-tauri/src/process.rs` (argument arrays, timeout, cleanup).
6. **Licences.** New dependencies must have permissive licences (MIT, Apache-2.0, BSD, ISC, Zlib, MPL-2.0 for unmodified use). Record them in `docs/THIRD_PARTY_NOTICES.md`. No GPL/AGPL code in the app.

## Development setup

Full Windows guide: [docs/SETUP_WINDOWS.md](docs/SETUP_WINDOWS.md). In short:

- Node.js LTS, Rust stable (MSVC), Microsoft C++ Build Tools, WebView2
- Optional for Word to PDF and OCR: LibreOffice, Tesseract

```powershell
npm install
npm run tauri dev
```

## Before you open a pull request

Run all of these and make sure they pass:

```powershell
npm test                 # Vitest
npm run typecheck        # app + tests
npm run build            # production frontend build
cd src-tauri
cargo clippy --all-targets   # must be warning-free
cargo test
```

Then, in the running app, manually check the tools you touched. Use the relevant sections of [docs/PHASE_2_TEST_PLAN.md](docs/PHASE_2_TEST_PLAN.md).

## Code style

- TypeScript `strict` stays on. Prefer small pure functions in `src/lib` with tests next to them (`*.test.ts`).
- Match the surrounding style: comments explain *why*, not what.
- User-facing errors: throw `DocError` with a specific code and a message that names the **file name only** and says what to do next. See the writing guidelines in [docs/DESIGN.md](docs/DESIGN.md).
- Accessibility: native controls, labels on icon buttons, status in live regions.
- Rust: no `unwrap()` on untrusted input; return `AppError`. Keep clippy clean.

## Where things go

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the source map and data flow, and [docs/DESIGN.md](docs/DESIGN.md) for the steps to add a new tool.

## Commit messages

Short imperative subject (`Add rotate pages tool`, `Fix temp cleanup after cancel`), and a body explaining why when it isn't obvious.

## Reporting bugs

Please include:
- DocCraft version and Windows version
- Which tool, what you did, what you expected, what happened
- The exact error text shown in the app
- **Do not attach confidential documents.** If possible, reproduce with a sample file you can share.

## Security issues

Please report vulnerabilities privately to the maintainer instead of opening a public issue.
