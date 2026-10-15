# Dependencies and Licenses

> **Phase 2:** the full, current licence review (including pdf.js, fflate, lopdf, image, and the detected engines LibreOffice and Tesseract) is in `docs/THIRD_PARTY_NOTICES.md`. This file keeps the library-selection reasoning. Phase 2 choices:
>
> | Need | Chosen | Why | Rejected |
> |---|---|---|---|
> | Text extraction, page rendering | **pdfjs-dist 6.4.299** (Apache-2.0, pinned) | Best-in-class, maintained by Mozilla, no runtime dependencies in the browser, handles CJK via cmaps | Rust `pdf-extract`/`lopdf::extract_text`: much weaker text decoding |
> | DOCX writing | **fflate 0.8.3** (MIT, pinned) + a ~60-line writer (`src/lib/docxWriter.ts`) | Tiny, dependency-free; full control of output | `docx` npm package: larger, more than we need for basic layout |
> | Compression | **lopdf 0.45** (MIT) + **image 0.25** (JPEG/PNG only) + **flate2** in Rust | In-process, bomb-safe decompression limits, no external binary, permissive licences | Ghostscript (AGPL), qpdf (extra binary; cannot downscale images) |
> | Word to PDF | **LibreOffice**, detected | Only realistic local DOCX renderer; MPL-2.0 | Bundling (350 MB); Microsoft Word automation (not always installed, COM automation) |
> | OCR | **Tesseract 5**, detected | Mature, Apache-2.0, produces searchable PDFs directly | Cloud OCR (forbidden); Windows.Media.Ocr (Windows-only, no PDF output) |
> | Temp folders | **tempfile** (MIT OR Apache-2.0) | Unpredictable names in the user temp folder | — |
>
> The Phase 1 notes below still apply to pdf-lib.

Collected on 2026-10-15 from `package-lock.json` / `src-tauri/Cargo.lock`. Re-check before any distribution, because versions change on `npm install` / `cargo update`.

DocCraft itself is licensed under MIT (see `LICENSE`).

## JavaScript: shipped in the app bundle

Output of `npm ls --omit=dev --all`:

| Package | Version | License | Purpose |
|---|---|---|---|
| pdf-lib | 1.17.1 (pinned) | MIT | PDF parsing, page copying and saving (merge) |
| @pdf-lib/standard-fonts | 1.0.0 | MIT | pdf-lib dependency |
| @pdf-lib/upng | 1.0.1 | MIT | pdf-lib dependency |
| pako | 1.0.11 | MIT AND Zlib | pdf-lib dependency (deflate) |
| tslib | 1.14.1 | 0BSD | pdf-lib dependency |
| react / react-dom | 19.3.1 | MIT | UI |
| scheduler | 0.28.0 | MIT | React dependency |
| @tauri-apps/api | 2.12.4 | Apache-2.0 OR MIT | Tauri IPC |
| @tauri-apps/plugin-dialog | 2.8.3 | MIT OR Apache-2.0 | Native open/save dialogs |
| @tauri-apps/plugin-fs | 2.7.1 | MIT OR Apache-2.0 | Reading/writing user-selected files |

## JavaScript: development only (not shipped)

`@tauri-apps/cli`, `vite`, `@vitejs/plugin-react`, `typescript`, `vitest`, `@types/react`, `@types/react-dom`. All are MIT or Apache-2.0 / MIT.

## Rust crates

Direct dependencies: `tauri` 2.12.4, `tauri-build` 2, `tauri-plugin-dialog` 2.8.3, `tauri-plugin-fs` 2.7.1, `serde`, `serde_json` (all MIT OR Apache-2.0).

The lockfile holds 422 crates across all platforms (not all are compiled on Windows). License summary from `cargo metadata`:

- Most crates are MIT, Apache-2.0, or dual MIT/Apache-2.0, with some Zlib, ISC, BSD-3-Clause, Unicode-3.0, Unlicense/MIT and CC0/MIT-0 options.
- **MPL-2.0** (file-level copyleft; unmodified use is fine, but source must be made available if you modify those files): `cssparser`, `cssparser-macros`, `dtoa-short`, `selectors` (used by Tauri's HTML tooling), `option-ext`.
- `r-efi`: MIT OR Apache-2.0 OR LGPL-2.1-or-later. Choose MIT/Apache.
- `brotli` 9.0.0: BSD-3-Clause AND MIT.
- `tao`, `sync_wrapper`: Apache-2.0.

Before distributing, generate a complete attribution file. For example, after installing the tools:

```powershell
cargo install cargo-about     # or cargo-license
cd src-tauri; cargo about generate about.hbs > ..\THIRD_PARTY_LICENSES.html
npx license-checker --production --summary
```

## Why pdf-lib 1.17.1

| Option | Notes |
|---|---|
| **pdf-lib 1.17.1** (chosen) | MIT, small dependency tree (4 deps), page copying is a core, heavily used feature, and no known advisories (`npm audit`: 0 vulnerabilities). Downside: no release since 2021. Pinned exactly so it only changes deliberately. |
| @cantoo/pdf-lib 2.11.x | Actively maintained, API-compatible MIT fork with encryption support. Not chosen for Phase 1: frequent releases plus open-ended `>=` dependency ranges (e.g. `tslib >=2`, `culori >=4`, `node-html-better-parser >=1.5.9`) make builds less reproducible and widen the supply-chain surface. Worth re-evaluating in Phase 2 if decryption or bug fixes are needed. |
| Rust `lopdf` via a Tauri command | Would keep file bytes off the IPC bridge and could scale better to large files. Not chosen for Phase 1 because merging with lopdf needs more hand-written object renumbering, and Rust code could not be compiled or tested on the development machine (no MSVC Build Tools). Candidate for later large-file work. |

Known pdf-lib quirks handled in code:
- Its error classes are compiled to ES5, so `instanceof EncryptedPDFError` is unreliable. DocCraft loads with `ignoreEncryption: true` and checks `isEncrypted` instead.
- It cannot decrypt, so any encrypted input (even one that opens without a password) is rejected rather than producing unreadable output.
