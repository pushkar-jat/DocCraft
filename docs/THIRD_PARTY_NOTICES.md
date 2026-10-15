# Third-Party Notices and Licensing Review

Reviewed 2026-10-15 against `package-lock.json` and `src-tauri/Cargo.lock`. Re-check before every release; versions change with `npm install` / `cargo update`.

**DocCraft itself is licensed under the MIT License** (see `LICENSE`). Several notices below must be reproduced in an installer or "About" screen when the app is distributed (see "Before distribution").

## 1. Bundled with the app

### JavaScript (in the webview bundle)

| Package | Version | License | Used for |
|---|---|---|---|
| pdf-lib | 1.17.1 (pinned) | MIT | Merge, split, extract, images to PDF, assembling OCR pages |
| @pdf-lib/standard-fonts, @pdf-lib/upng | 1.0.0, 1.0.1 | MIT | pdf-lib dependencies |
| pako | 1.0.11 | MIT AND Zlib | pdf-lib dependency |
| tslib | 1.14.1 | 0BSD | pdf-lib dependency |
| pdfjs-dist | 6.4.299 (pinned) | Apache-2.0 | Text extraction (PDF to Word, OCR check) and page rendering for OCR |
| fflate | 0.8.3 (pinned) | MIT | Writing the DOCX zip container |
| react, react-dom, scheduler | 19.3.1, 0.28.0 | MIT | UI |
| @tauri-apps/api, plugin-dialog, plugin-fs | 2.12.4, 2.8.3, 2.7.1 | MIT OR Apache-2.0 | Tauri IPC, native dialogs, scoped file access |

**pdf.js data files** are copied into the app from `node_modules/pdfjs-dist` by `scripts/copy-pdfjs-assets.mjs` and loaded locally:

| Folder | Contents | License |
|---|---|---|
| `cmaps/` | Adobe character maps | BSD-3-Clause style (Adobe), see `node_modules/pdfjs-dist/cmaps/LICENSE` |
| `standard_fonts/` (Foxit only) | Substitutes for non-embedded standard fonts | BSD-3-Clause (PDFium/Foxit), see `standard_fonts/LICENSE_FOXIT` |
| `wasm/openjpeg.wasm` | JPEG 2000 decoder | BSD-2-Clause (OpenJPEG) + Mozilla BSD wrapper |
| `wasm/jbig2.wasm` | JBIG2 decoder | BSD-3-Clause (PDFium) + Apache-2.0 wrapper |
| `wasm/qcms_bg.wasm` | Colour management | MIT (qcms) |
| `wasm/quickjs-eval.*` | Sandboxed evaluator used internally by pdf.js | MIT (QuickJS) |
| `iccs/` | ICC profile | CC0-1.0 |

Deliberately excluded: pdf.js's **Liberation fonts** (`LiberationSans-*.ttf`) are licensed GPLv2 with a font exception. To keep GPL files out of the installer, `scripts/copy-pdfjs-assets.mjs` skips them, and pdf.js uses system fonts for those non-embedded fonts instead. Shipping them is possible if the GPL text and a source offer (the TTF files themselves) are included.

Not shipped: `@napi-rs/canvas` (MIT) is an optional, Node-only dependency of pdfjs-dist used for server-side rendering. The package is not bundled; the production bundle only contains a reference to it inside a Node-only code path that never runs in the webview (checked, see `docs/PHASE_2_STATUS.md`).

### Rust (compiled into `doccraft.exe`)

Direct dependencies: `tauri` 2.12 (MIT OR Apache-2.0), `tauri-plugin-dialog`, `tauri-plugin-fs` (MIT OR Apache-2.0), `serde`, `serde_json` (MIT OR Apache-2.0), **`lopdf` 0.45 (MIT)**, **`image` 0.25 (MIT OR Apache-2.0)** with only the JPEG (`zune-jpeg`: MIT OR Apache-2.0 OR Zlib) and PNG (`png`: MIT OR Apache-2.0) codecs, **`flate2` 1.1 (MIT OR Apache-2.0)**, **`tempfile` 3 (MIT OR Apache-2.0)**. Dev-only (tests): `ab_glyph` (Apache-2.0).

`Cargo.lock` lists 469 crates for all platforms (not all are compiled on Windows). Licences needing attention:
- **MPL-2.0** (file-level copyleft; unmodified use is fine, but modified MPL files must be published): `cssparser`, `cssparser-macros`, `dtoa-short`, `selectors` (Tauri's build-time HTML tooling), `option-ext`.
- `r-efi` (MIT OR Apache-2.0 OR LGPL-2.1-or-later): use under MIT/Apache.
- `encoding_rs`: (Apache-2.0 OR MIT) AND BSD-3-Clause.
- `brotli`: BSD-3-Clause AND MIT. `tao`, `sync_wrapper`: Apache-2.0.

## 2. External engines: detected, never bundled

DocCraft does **not** ship these programs. It looks for an existing installation and runs it locally. If one is missing, the tools that need it show a "not found" notice with setup instructions, and their actions are disabled.

| Engine | Used for | License | Why it is not bundled |
|---|---|---|---|
| LibreOffice (tested: 26.2.1.2) | Word/ODT/RTF to PDF | MPL-2.0 (some parts LGPLv3+, Apache-2.0) | About 350 MB. Bundling is legally possible, but requires shipping its notices and source offer, plus a large installer and update burden. A user-installed copy keeps DocCraft small. |
| Tesseract OCR (tested: 5.4.0.20240606, UB Mannheim build) | OCR / searchable PDF | Apache-2.0; language data (tessdata) Apache-2.0 | Bundling is permitted. Deferred to keep the installer small and to let users choose languages. Revisit for a "batteries included" release. |

How DocCraft runs them (`src-tauri/src/process.rs`, `convert.rs`, `ocr.rs`):
- Direct process launch with an argument array, never a shell. The user's file name never reaches the command line: the document is copied to a private temp folder under a fixed name (`document.docx`, `page.jpg`).
- No console window, a 5-minute timeout, and cancellation that kills the whole process tree.
- The temp folder is deleted on every outcome, with retries while a killed engine releases its files.
- LibreOffice runs with a dedicated DocCraft profile (in the app's local data folder) with macro execution disabled, untrusted referer links blocked, and update checks and usage reporting turned off. One conversion runs at a time.

## 3. Not used, and why

| Option | Reason |
|---|---|
| Ghostscript (compression) | AGPL-3.0: bundling would require the whole app to be AGPL-compatible. Compression is implemented natively with lopdf + image instead. |
| qpdf | Apache-2.0 and good, but another external binary. lopdf covers what DocCraft needs. |
| Cloud conversion/OCR APIs | Forbidden by the product principles (local-only). |
| `@cantoo/pdf-lib` | See `docs/DEPENDENCIES.md`: open-ended dependency ranges and a larger supply-chain surface. |

## Before distribution

1. DocCraft's own license: MIT (`LICENSE`), chosen 2026-10-15.
2. Generate a complete attribution file and include it with the installer:
   ```powershell
   cargo install cargo-about
   cd src-tauri; cargo about generate about.hbs > ..\THIRD_PARTY_LICENSES.html
   npx license-checker --production --summary
   ```
   Then add the pdf.js data-file licenses listed above.
3. If LibreOffice or Tesseract is ever bundled, add their full notices and (for LibreOffice) the MPL source offer.
