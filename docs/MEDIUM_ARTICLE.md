# I Built an Offline PDF Toolkit So You Never Have to Upload Your Documents Again

### DocCraft is a free, open-source desktop app that merges, splits, compresses, converts and OCRs your files — entirely on your own computer.

![DocCraft dashboard showing nine PDF tools](https://raw.githubusercontent.com/pushkar-jat/DocCraft/main/docs/screenshots/dashboard.png)

---

Think about the last time you needed to merge two PDFs, shrink a file for an email attachment, or turn a scanned invoice into searchable text. Chances are you searched for "merge PDF online", dropped your file onto a website, and downloaded the result.

It works. But look at what you just uploaded: a signed contract, a bank statement, a passport scan, a medical report. All of it went to a server you know nothing about, run by a company whose privacy policy you didn't read.

I wanted the convenience of those websites **without handing my documents to anyone**. So I built **DocCraft**: a small desktop app that does the everyday PDF jobs locally, offline, with no account and no tracking.

It's free and open source under the MIT license:
👉 **[github.com/pushkar-jat/DocCraft](https://github.com/pushkar-jat/DocCraft)**

---

## What DocCraft can do

DocCraft has nine tools on one dashboard:

- 📎 **Merge PDF**: combine PDFs in the order you choose
- ✂️ **Split PDF**: one file per page range, or every N pages
- 📄 **Extract pages**: copy pages, in any order (3, 1, 5–8), into a new PDF
- 🗜️ **Compress PDF**: three clear presets, with before/after size shown
- 🖼️ **Images to PDF**: JPEG/PNG to one PDF; phone-photo rotation respected
- 📝 **PDF to Word**: editable DOCX from a text PDF (basic layout)
- 📃 **Word to PDF**: DOCX, DOC, ODT, RTF to PDF (uses LibreOffice)
- 🔍 **OCR / searchable PDF**: make scans searchable and copyable (uses Tesseract)
- 📚 **Batch processing**: compress or convert many files at once

Every one of these runs on your machine. Unplug your network cable and they still work.

---

## A quick tour

### Merge: arrange first, then combine

Pick your PDFs in the normal Windows file dialog, drag them into order with the up/down arrows, and press **Merge PDFs**. Picking the same file twice? DocCraft notices and skips the duplicate.

![Merging three PDFs in a chosen order](https://raw.githubusercontent.com/pushkar-jat/DocCraft/main/docs/screenshots/merge.png)

Your original files are never touched, and the output can never overwrite one of them. If you choose an existing file name, Windows asks before replacing it.

### Split and extract: page ranges that explain themselves

Type ranges like `1-3, 4-6, 7-10` and DocCraft checks them as you type. Overlapping pages, reversed ranges (`5-3`), pages that don't exist, stray commas: each gets a plain-English message instead of a cryptic failure.

![Splitting a PDF with custom page ranges](https://raw.githubusercontent.com/pushkar-jat/DocCraft/main/docs/screenshots/split.png)

Split writes one file per range into a folder you choose. If a file with the same name already exists, DocCraft picks a new name like `report_pages_1-3 (2).pdf` rather than overwriting it.

### Compress: see the saving before you save

Most "compress PDF" tools just say "done". DocCraft shows you exactly what happened, and the three presets each map to real, documented behaviour:

- **Higher quality (lossless):** cleans up and recompresses the document's internal structure. Images are untouched.
- **Balanced:** also re-encodes photos and downsizes very large images (over 2500 px).
- **Smaller file:** converts images to more compact JPEGs, up to 1600 px. Images may look softer.

![Compressing a photo-heavy PDF by 44.5%](https://raw.githubusercontent.com/pushkar-jat/DocCraft/main/docs/screenshots/compress.png)

And if a PDF *can't* be made smaller, DocCraft says so and doesn't offer to save a bigger file. That kind of honesty is rarer than it should be.

### OCR: turn a scan into searchable text

Scanned documents are just pictures of text: you can't search them or copy from them. The OCR tool renders each page, recognises the text with [Tesseract](https://github.com/tesseract-ocr/tesseract), and saves a PDF that looks identical but contains a hidden text layer you can search and copy.

![OCR making a scanned invoice searchable](https://raw.githubusercontent.com/pushkar-jat/DocCraft/main/docs/screenshots/ocr.png)

In my tests, a scanned invoice came back with every word and number correct: "INVOICE 4711 … Total amount due: 1,234.56 EUR".

### PDF to Word, with honest limits

PDF to Word extracts text, paragraphs, headings and page breaks into an editable DOCX. It's labelled **basic layout** right in the app, because PDFs don't really contain "paragraphs" or "tables", and I'd rather tell you upfront than surprise you.

![Converting a PDF to an editable Word document](https://raw.githubusercontent.com/pushkar-jat/DocCraft/main/docs/screenshots/pdf-to-word.png)

If you give it a scanned PDF, it won't create an empty Word file and pretend it worked. It tells you the file is probably a scan and suggests running OCR first.

### Batch: one bad file never stops the rest

Need to compress forty PDFs, or convert a folder of Word documents? Add them to the batch queue, pick an output folder, and press start. Files are processed one at a time, each with its own status, and a damaged file fails on its own without affecting the rest.

![Batch processing with per-file status](https://raw.githubusercontent.com/pushkar-jat/DocCraft/main/docs/screenshots/batch.png)

You can cancel at any point, and retry just the failed items afterwards.

---

## How "private" is private?

"Offline" is easy to claim, so here is what DocCraft actually does:

- **No network code at all.** The app's security policy only allows connections to the app itself. Even the PDF engine's helper files (fonts, character maps) ship inside the app instead of loading from the internet.
- **It can only see files you pick.** DocCraft has no general access to your disk. It can open exactly the files you choose in a Windows file dialog, and save exactly where you tell it to.
- **No accounts, telemetry, analytics or ads.** There's nothing to sign up for and nothing phoning home.
- **Temporary files are cleaned up**, even when you cancel halfway through.

---

## Under the hood (for developers)

DocCraft is built with **[Tauri 2](https://tauri.app)** (a Rust core with a lightweight web UI) and **React + TypeScript**. The Windows installer is about **4 MB**.

A few design decisions I'm happy with:

- **Heavy work never freezes the window.** PDF manipulation with [pdf-lib](https://pdf-lib.js.org) runs in a Web Worker; text extraction and page rendering use Mozilla's [pdf.js](https://mozilla.github.io/pdf.js/); compression runs natively in Rust with [lopdf](https://github.com/J-F-Liu/lopdf) and the [image](https://github.com/image-rs/image) crate.
- **Rust commands take bytes, not file paths.** The UI reads the file you picked and sends its contents. The native side never gets a path it could misuse.
- **External engines are run carefully.** Word to PDF uses a locally installed LibreOffice and OCR uses Tesseract. Both run without a shell, on a temporary copy with a fixed name, with a timeout and a cancel button that stops the whole process.
- **Honest progress bars.** If an engine can report real progress (pages, images, files), you see a percentage. If it can't, you see an indeterminate bar, not an invented number.
- **Every flow was tested end to end.** Besides 118 frontend tests and 22 Rust tests (including real LibreOffice and Tesseract runs), each tool was driven through the real app and real Windows dialogs, and the output files were checked independently.

The repository includes an [architecture guide](https://github.com/pushkar-jat/DocCraft/blob/main/docs/ARCHITECTURE.md) with diagrams and a [design guide](https://github.com/pushkar-jat/DocCraft/blob/main/docs/DESIGN.md) that explains how to add a new tool.

---

## What it doesn't do (yet)

I'd rather be upfront:

- **PDF to Word** doesn't reproduce images, tables or multi-column layouts yet.
- **Compression** helps most with photo-heavy PDFs. Already-optimized files and some scans may not shrink.
- **Password-protected PDFs** aren't supported yet.
- It's **Windows-only** for now. macOS and Linux builds are planned.

---

## Try it

1. **[Download DocCraft for Windows](https://github.com/pushkar-jat/DocCraft/releases/latest/download/DocCraft_x64-setup.exe)** (about 4 MB, always the latest version).
2. Run it. The app isn't code-signed yet, so Windows may show *"Windows protected your PC"*: click **More info → Run anyway**.
3. Open **DocCraft** from the Start menu.

Word to PDF and OCR need two free programs, which you install once (DocCraft finds them automatically):

```
winget install TheDocumentFoundation.LibreOffice
winget install UB-Mannheim.TesseractOCR
```

Everything else works out of the box.

---

## Help make it better

DocCraft is open source under the MIT license, and contributions are welcome: bug reports, feature ideas, or code.

- ⭐ **Star the repo** if you find it useful: [github.com/pushkar-jat/DocCraft](https://github.com/pushkar-jat/DocCraft)
- 🐛 **Report issues** (please don't attach confidential documents)
- 🛠️ **Contribute**: start with the [contributing guide](https://github.com/pushkar-jat/DocCraft/blob/main/CONTRIBUTING.md)

Your documents are yours. Your PDF tools should respect that.

---

*Tags: PDF, Privacy, Open Source, Rust, Tauri*
