# Full Toolkit — Status and Verification Report

Date: 2026-10-18 · Windows 11 Pro 22621 x64 · Node 24.13.0 · Rust 1.99.0 (MSVC) · LibreOffice 26.2.1.2 · Tesseract 5.4.0.20240606

Scope: extend DocCraft from the nine Phase 2 tools to the full everyday PDF menu (organize, optimize, convert to/from PDF, edit, security, intelligence), all running locally. Phase 2 results are in [PHASE_2_STATUS.md](PHASE_2_STATUS.md).

**Summary:** 32 tools are implemented. The new tools are covered by unit tests and, where an engine or crypto is involved, by integration tests against the real engine or an independent verifier. **They have not yet been clicked through in the running desktop app**, so this is not declared release-ready. See [Still open](#still-open).

## Decisions

| Request | Decision |
|---|---|
| AI Summarizer, Translate PDF | Shown as **Not available yet** (disabled, with the reason). They would need a cloud AI service, which DocCraft does not use. |
| Sign PDF | Visual signature (draw, type, image) **and** optional certificate signing (PAdES B-B) with the user's .pfx/.p12. |
| Scan to PDF | Scanner (Windows WIA dialog) **and** camera capture. |

## Feature status

| Group | Tool | Implementation | Automated evidence |
|---|---|---|---|
| Organize | Remove pages, Organize PDF | pdf-lib in the worker (`pageTools.ts`, `organize.ts`) | page order/count, rotation, blank pages, invalid selections |
| Organize | Scan to PDF | `scan.rs` (WIA via fixed PowerShell script), camera via `getUserMedia`, `imageFilters.ts` | missing-scanner path on this machine (real WIA call); document-mode filter; A4 DPI |
| Optimize | Repair PDF | `security.rs` rebuild, pdf-lib salvage fallback | damaged-xref and missing-catalog files repaired; hopeless files refused |
| Convert to PDF | PowerPoint, Excel, HTML | LibreOffice (`convert.rs`) | real LibreOffice runs on `sample.pptx` / `sample.xlsx` / HTML; remote references neutralized |
| Convert from PDF | PDF to JPG/PNG | pdf.js rendering | — (UI only; renderer shared with OCR) |
| Convert from PDF | PDF to Excel | `tableLayout.ts`, `xlsxWriter.ts` | column detection, XLSX structure |
| Convert from PDF | PDF to PowerPoint, PDF/A | LibreOffice | real LibreOffice runs; PDF/A output carries PDF/A identification |
| Edit | Rotate, Page numbers, Watermark, Crop | `pageTools.ts`, `pageGeometry.ts` | rotation maths, anchors on rotated/cropped pages, ranges |
| Edit | Edit PDF | `annotate.ts`, `PageEditor.tsx` | overlay placement on rotated/cropped pages, text wrapping |
| Edit | PDF Forms | `forms.ts` | read/fill text, checkbox, radio, dropdown; flattening; unsupported characters explained |
| Security | Protect, Unlock | `security.rs` (AES-256, R6) | round trip, wrong password, unencrypted input, permissions |
| Security | Sign | `pdfsign.rs` | CMS signature verified in tests; sample verified independently with .NET `SignedCms` |
| Security | Redact | `textSearch.ts`, `redact.ts` | redacted pages flattened, text no longer extractable, other pages copied unchanged |
| Security | Compare | `textDiff.ts`, `compare.ts` | Myers diff, word-level changes, report |
| Intelligence | PDF to Markdown | `markdown.ts` | headings, lists, paragraphs |

## Commands run (final state of the code)

| Command | Result |
|---|---|
| `npm run typecheck` | **Pass** (app and tests) |
| `npm test` | **Pass**: 21 files, 179 tests |
| `npm run build` | **Pass** (warning only: a chunk larger than 500 kB) |
| `cargo test` (in `src-tauri`) | **Pass**: 41 tests, with LibreOffice and Tesseract present |
| `cargo clippy --all-targets` | **Pass**, no warnings |

## Privacy confirmation

- No network code was added. The production CSP is unchanged and still blocks every non-app connection.
- HTML to PDF neutralizes `http:`, `https:`, protocol-relative and `file:` references before LibreOffice sees the file.
- New native commands take bytes, never user paths. Passwords are percent-encoded headers and are not logged.
- The camera starts only on an explicit click; frames stay in memory until the user saves.

## Still open

1. **Click-through in the real app** of every new tool (dev and release builds), including native dialogs. Not run yet: GUI automation sends real keystrokes, so it needs the PC to be free.
2. **Camera permission in WebView2**: expected to show WebView2's permission prompt the first time; not verified on this machine.
3. **Scanner acquisition** with a real scanner: only the "no scanner" path was tested (no scanner attached).
4. **Signatures in Adobe Acrobat**: verified cryptographically, not yet opened in Acrobat. Self-signed certificates will show as "unknown signer".
5. **PDF/A validation** with an external validator (e.g. veraPDF) not run.
6. Batch processing still covers the Phase 2 operations only.
7. Items 1–4 of the Phase 2 list (installer install/uninstall, very large files, offline retest, human layout review) still apply.
