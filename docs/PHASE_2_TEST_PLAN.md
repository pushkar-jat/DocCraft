# DocCraft Phase 2 — Full Feature Test Plan

Use only non-sensitive test documents you own or are authorized to use. Record Pass, Fail, or Not run for every test.

**Results recorded 2026-10-15.** "App" = run in the real desktop app by driving its UI and the native Windows dialogs. "Auto" = automated test (`npm test` / `cargo test`). "Release" = also repeated on the release build (production CSP). Fixtures were generated locally: `text10.pdf` (10 text pages), `photos.pdf` (3 pages, 3000×2000 JPEG), `scan.pdf` (2 image-only pages of text), `sample doc with spaces.docx` (heading, paragraph, table, embedded image, page break), `big.docx` (400 sections with tables), `photo.jpg`, `portrait.png`, `scan.png`, `fake.pdf` / `broken.jpg` (text files with the wrong extension).

## Merge
- [x] Merge 2+ PDFs; verify page count and order. — **Pass** (App, Release; output re-read with pdf.js: 12 pages, Chapter 1–10 then the 2 scan pages)
- [x] Reorder inputs; verify order changes. — **Pass** (App)
- [x] Duplicate selection is prevented. — **Pass** (App: "1 file already in the list was skipped: text10.pdf.")
- [x] Cancel open/save dialogs. — **Pass** (App: cancelling the file picker left the list unchanged; Auto for save dialog)
- [x] Malformed/encrypted inputs fail safely. — **Pass** (Auto; App: a missing file is reported by name with no output)
- [x] Source files remain unchanged. — **Pass** (App: SHA-256 identical before and after)

## Split/extract
- [x] Parse `4`, `2-6`, and `1-2, 5, 8-10`. — **Pass** (Auto)
- [x] Reject empty/malformed tokens, zero/negative, reversed, out-of-range, and overlapping selections. — **Pass** (Auto; App: live messages for `1-3, 2`, `5-3`, `12`, `1,,2`, `0`, `abc`)
- [x] Split creates the correct number of files with expected page counts/order. — **Pass** (App: `1-3, 4-6, 7-10` → 3 files; file 2 = Chapters 4–6)
- [x] Extract `3, 1, 2` produces that exact page order. — **Pass** (App; output re-read: Chapter 3, 1, 2)
- [x] Output collisions and source-path selection are safe. — **Pass** (App: repeat split produced `… (2).pdf`, originals' hashes unchanged; Auto: output equal to an input is refused)

## Compression
- [x] Test an image-heavy PDF and a text/vector PDF. — **Pass** (App, Release: photos.pdf Balanced 524.0 KB → 290.7 KB (−44.5%); text10.pdf lossless 9.2 KB → 9.2 KB (−0.4%); Auto for all presets)
- [x] Confirm output opens and content is readable. — **Pass** (output re-read with pdf.js: 3 pages; Auto: reload + text check)
- [x] Verify displayed input/output sizes and percentage calculation. — **Pass** (App; Auto for `percentChange`)
- [x] Test a PDF that grows in size; app must not falsely claim reduction. — **Pass** (App: re-compressing an optimized file → "could not be made smaller … Nothing to save"; no Save button)
- [x] Confirm quality preset behavior is real and documented. — **Pass** (Auto: High leaves images untouched; Balanced downsizes to 2500 px; Small to 1600 px and is smaller than Balanced)

## Word to PDF
- [x] Convert DOCX with paragraphs, tables, images, and page breaks. — **Pass** (App, Release, Auto with the real LibreOffice: 2 pages, text present)
- [ ] Confirm output PDF opens and layout is reasonable. — **Partially** (opens; text and page break verified programmatically). **Visual layout review by a person: Not run.**
- [x] Test when the conversion engine is missing; show setup guidance. — **Pass** (Release app launched with the engines hidden: guidance shown, Convert disabled, batch option marked)
- [x] Test filenames and directories containing spaces. — **Pass** (App: `sample doc with spaces.docx`; project path has spaces)

## PDF to Word
- [x] Convert a text-based PDF; open output DOCX in a compatible editor. — **Pass** (App, Release; Auto: LibreOffice opens the DOCX and reads its text). **Microsoft Word: Not run.**
- [x] Confirm extracted text is present and not empty. — **Pass** (10 pages, 15,321 characters, 9 page breaks)
- [ ] Test a PDF with columns/tables and record layout limitations. — **Not run** on a real-world sample. Known limitation (documented): columns and tables are flattened into paragraphs in reading order.
- [x] Test scanned PDF; explain OCR requirement or run local OCR workflow. — **Pass** (App: refused with "probably a scanned image. Run OCR … first"; no file written)
- [x] Confirm unsupported documents do not report false success. — **Pass** (Auto: invalid/encrypted PDFs fail with messages)

## Images to PDF
- [x] Convert one JPG, one PNG, and multiple images. — **Pass** (App: photo.jpg + scan.png + portrait.png → 3 pages; Auto for single images)
- [x] Reorder images and verify PDF page order. — **Pass** (App; page sizes 842×595, 595×842, 595×842 confirm order and orientation)
- [x] Test invalid/corrupt images and large images. — **Pass** (App: `broken.jpg` named in the error, no output; 3000×2000 photo OK. Auto: truncated JPEG rejected, EXIF rotation)

## Batch
- [x] Run a batch with multiple successful files. — **Pass** (App: compress, Word to PDF, PDF to Word, OCR)
- [x] Include one invalid file; other jobs should continue safely. — **Pass** (App: `fake.pdf` failed, the other two succeeded)
- [x] Verify per-file status and final summary. — **Pass** (App: "2 done, 1 failed, 0 cancelled")
- [x] Confirm concurrency/memory remains reasonable. — **Pass** (Auto: never more than one item at a time; per-file size caps)
- [x] Retry a failed item if supported. — **Pass** (App: cancel mid-batch → both cancelled; Retry → both done)

## OCR
- [x] Run a known scanned PDF through local OCR. — **Pass** (App, Release; Auto with the real Tesseract)
- [x] Search/select text in resulting searchable PDF or verify extracted text, depending on implementation. — **Pass** (re-read with pdf.js: "INVOICE 4711 DocCraft scanned sample page Total amount due: 1,234.56 EUR Thank you for your business")
- [x] Test missing OCR runtime detection. — **Pass** (Release app with engines hidden)
- [x] Confirm no network request is made. — **Pass by inspection** (no network code; production CSP blocks non-local connections; Tesseract runs as a local process). A packet capture was **not** run.

## General/release
- [ ] Use representative large files and verify UI remains responsive. — **Not run** with large real-world files (largest tested: 524 KB PDF, 400-section DOCX).
- [x] Verify cancellation and temporary-file cleanup where supported. — **Pass** (App: cancelling LibreOffice killed it, wrote no output, left no temp folder; this test found and fixed a leftover-temp bug. Auto: worker/OCR/merge cancellation)
- [x] Confirm no input file is modified or silently overwritten. — **Pass** (App: hashes; native "Confirm Save As" prompt seen; folder outputs auto-rename)
- [ ] Disconnect internet and retest core operations. — **Not run.**
- [x] Run automated tests, frontend build, Rust checks, and Tauri build. — **Pass** (see `docs/PHASE_2_STATUS.md`)
- [ ] Install/uninstall/reinstall Windows package if release readiness is claimed. — **Not run** (release readiness not claimed).
