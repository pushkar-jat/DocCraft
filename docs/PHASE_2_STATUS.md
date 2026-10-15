# Phase 2 — Status and Verification Report

Date: 2026-10-15 · Windows 11 Pro 22621 x64 · Node 24.13.0 · Rust 1.99.0 (MSVC 14.44, Windows SDK 10.0.26100) · LibreOffice 26.2.1.2 · Tesseract 5.4.0.20240606

**Summary:** all nine Phase 2 features are implemented and were verified in the real desktop app (dev and release builds) and by automated tests. **Phase 2 is not declared complete as a release.** These items are still open:
1. Install/uninstall/reinstall of the built installers has not been run.
2. Very large real-world files have not been measured for responsiveness.
3. Offline (network disconnected) retest has not been run.
4. A person has not visually reviewed Word to PDF layouts or opened PDF to Word output in Microsoft Word.
5. PDF to Word is a deliberate **basic layout** MVP (no images, tables or columns).

## Feature status

| Feature | Status | Evidence |
|---|---|---|
| A. PDF merge (hardened) | **Implemented and tested** | Now runs in a Web Worker. App: order, de-duplication, reorder, save; inputs hash-identical; 12 pages in the chosen order. Auto: 30+ tests |
| B. Split & extract | **Implemented and tested** | App: ranges, every-N, folder output, " (2)" collision names, extract order 3,1,2. Auto: parser (all rejection cases), split/extract order |
| C. Compress | **Implemented and tested** | Rust lopdf+image. App/Release: 524 KB → 291 KB (−44.5%) image PDF; text PDF −0.4%; "could not be made smaller" path. Auto: 9 Rust tests |
| D. Word to PDF | **Implemented and tested**; visual layout review by a person pending | LibreOffice detected. App/Release + Rust test with real LibreOffice; cancel kills the engine and cleans temp files; missing-engine UX verified |
| E. PDF to Word | **Implemented and tested as a basic-layout MVP**; advanced layout (images, tables, columns) **not implemented** | pdf.js + own DOCX writer. App/Release: 10 pages, 15,321 chars; scanned PDFs refused with OCR guidance; Auto: LibreOffice opens the DOCX |
| F. Images to PDF | **Implemented and tested** | App: JPG+PNG, reorder, orientation, corrupt image named. Auto: EXIF (all 8 orientations), page sizing, validation |
| G. Batch | **Implemented and tested** | App: all four operations; failure isolation; cancel; retry; summary. Auto: sequential runner, isolation, cancel, retry |
| H. OCR / searchable PDF | **Implemented and tested** | Tesseract detected. App/Release: scan.pdf → exact text "INVOICE 4711 … 1,234.56 EUR". Rust test renders text and OCRs it with the real Tesseract |
| Dashboard / UX | **Implemented and tested** | 9 tools; engine-dependent tools tagged; no fake buttons; accessible status regions. Keyboard-only walkthrough by a person not run |

## Commands run (final state of the code)

| Command | Result |
|---|---|
| `npm test` | **Pass**: 12 files, 118 tests |
| `npm run typecheck` (app + tests) | **Pass** |
| `npm run build` | **Pass** |
| `cargo clippy --all-targets` (src-tauri) | **Pass**, 0 warnings |
| `cargo test` (src-tauri) | **Pass**: 22 tests, including real LibreOffice and Tesseract runs (confirmed not skipped with `--nocapture`) |
| `npm run tauri build` | **Pass**: `DocCraft_0.1.0_x64_en-US.msi` (4.91 MiB), `DocCraft_0.1.0_x64-setup.exe` (4.05 MiB) |
| Release `doccraft.exe` smoke test under production CSP | **Pass**: PDF→Word, OCR, Compress, Merge, Word→PDF; engine-missing UX |
| Installer install/uninstall | **Not run** |

The baseline before Phase 2 (Phase 1 code) passed `npm test` (62), `npm run build` and `npm run tauri build`.

## How the app was verified

The desktop app was driven end to end, with no test hooks in the product code:
- Page actions went over WebView2's DevTools protocol on a localhost-only port, enabled with the `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` environment variable for the test session.
- Native Windows open, save and folder dialogs were filled with the keyboard and mouse.
- Output files were then re-read independently with pdf.js and fflate.

## Defects found and fixed during verification

1. **Leftover document copy after cancelling Word to PDF.** A just-killed LibreOffice still held the temp copy when it was deleted. Fixed with `process::with_temp_dir`: cleanup on every outcome, retried briefly. Covered by a Rust test and re-verified in the app (0 temp folders left).
2. **Dev server reloaded the page mid-job.** Vite discovered worker-only dependencies at runtime and reloaded. Fixed with `optimizeDeps.include`. Dev-only; release builds were not affected.
3. **GPL font files in the bundle.** pdf.js's Liberation fonts (GPLv2 with font exception) are now excluded from the installer (see `THIRD_PARTY_NOTICES.md`).
4. pdf-lib's encrypted-PDF error could not be detected with `instanceof` (found in Phase 1, still handled by checking `isEncrypted`).

## Runtime requirements and detection

- **LibreOffice** (Word to PDF) and **Tesseract + language data** (OCR) are detected at start-up in standard install folders and on PATH (`src-tauri/src/engines.rs`). They are not bundled; see `THIRD_PARTY_NOTICES.md`.
- When missing, the dashboard tags the tool "Needs … (not found)". The tool shows install instructions and a **Check again** button, and its action is disabled. Batch marks those operations as needing the engine.
- Everything else (merge, split, extract, compress, images, PDF to Word) needs no external software.

## Known limitations

**Compression**
- Only 8-bit RGB/greyscale JPEG and Flate images are re-encoded. CMYK, indexed, JPEG 2000, JBIG2/CCITT, masked or Decode-array images are left as they are, so some scanned PDFs shrink little.
- Downscaling is by pixel size (2500 px / 1600 px longest side), not by the printed DPI on the page.
- Fonts are not subset and content streams are not rewritten. Already-optimized PDFs may not shrink; DocCraft then reports this and offers nothing to save.
- Encrypted PDFs are refused.

**PDF to Word (basic layout)**
- Keeps text, paragraphs, larger text as bold headings, font sizes and page breaks.
- Not reproduced: images, tables, columns (flattened in reading order), fonts, colours, headers/footers, exact positions. Lines with wide spacing may become separate paragraphs.
- Scanned PDFs are refused (run OCR first). Encrypted PDFs are refused.

**Word to PDF**
- Fidelity is LibreOffice's; fonts not installed on the computer are substituted.
- Password-protected documents fail with a conversion error.
- No progress percentage (LibreOffice cannot report it); 5-minute timeout per document. The first conversion is slower (about 20 s) while the private profile is created.
- Linked (not embedded) external content: DocCraft's LibreOffice profile blocks untrusted referer links and macros, but this hardening is best-effort.

**OCR**
- Only installed languages are offered; one language per run in the UI.
- Pages are rasterized at 300 dpi (lower for huge pages); output pages are images with an invisible text layer. Any existing text layer is replaced, and file size usually grows.
- Up to 500 pages per file. Accuracy depends on scan quality.

**General**
- Inputs are read fully into memory. Caps: 1 GiB total for merge, 512 MB per file for other tools, 512 MB of images. Very large files may be slow.
- No password prompt for encrypted PDFs.
- No drag and drop.
- Dev builds run without CSP (`devCsp: null`); the strict CSP applies to release builds and was tested there.
- The bundle identifier `com.doccraft.app` ends in `.app`. Tauri warns this conflicts with macOS bundle naming; change it before a macOS build. Changing it moves the app-data folder.

## Privacy confirmation

All document processing is local:
- pdf-lib and pdf.js run in the webview and its workers.
- Compression runs in the Rust process.
- LibreOffice and Tesseract run as local child processes on temp copies that are deleted afterwards.

There is no network code, telemetry, analytics, account or cloud feature. The production CSP permits connections only to the app itself and Tauri IPC. pdf.js data files are bundled, not fetched from a CDN. The production bundle has no `fetch("http…")` calls. Its only `@napi-rs/canvas` reference is in a Node-only branch that never runs in the app.

## Manual tests still required

See the unchecked items in `docs/PHASE_2_TEST_PLAN.md`:
- Install, launch, uninstall and reinstall the MSI and NSIS installers.
- Repeat a few operations with the network disconnected.
- Run large real-world files (e.g. a 200-page scanned PDF, a 100 MB photo PDF) and watch responsiveness and memory.
- Open converted DOCX files in Microsoft Word; review Word to PDF layouts by eye.
- Try PDFs with columns and tables in PDF to Word, and record the result.
- Do a keyboard-only and screen-reader pass through every tool.
