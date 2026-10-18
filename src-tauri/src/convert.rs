//! Document conversions through a locally installed LibreOffice running headless:
//! Word/PowerPoint/Excel/OpenDocument/RTF/HTML -> PDF, PDF -> PowerPoint, and PDF -> PDF/A.

use std::path::Path;
use std::sync::atomic::AtomicBool;
use std::sync::{LazyLock, Mutex};
use std::time::Duration;

use regex::bytes::Regex;

use crate::errors::AppError;
use crate::process::{quiet_command, run, with_temp_dir, RunError};

pub const CONVERSION_TIMEOUT: Duration = Duration::from_secs(300);

/// LibreOffice instances sharing one profile hand work to each other, so run one at a time.
static SOFFICE_LOCK: Mutex<()> = Mutex::new(());

/// Profile settings applied the first time DocCraft's private LibreOffice profile is created:
/// block macros, block untrusted referer links, and turn off update checks and usage reporting.
const PROFILE_SETTINGS: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<oor:items xmlns:oor="http://openoffice.org/2001/registry" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop></item>
<item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="DisableMacrosExecution" oor:op="fuse"><value>true</value></prop></item>
<item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="BlockUntrustedRefererLinks" oor:op="fuse"><value>true</value></prop></item>
<item oor:path="/org.openoffice.Office.Jobs/Jobs/org.openoffice.Office.Jobs:Job['UpdateCheck']/Arguments"><prop oor:name="AutoCheckEnabled" oor:op="fuse"><value>false</value></prop></item>
<item oor:path="/org.openoffice.Office.Common/Misc"><prop oor:name="CollectUsageInformation" oor:op="fuse"><value>false</value></prop></item>
</oor:items>
"#;

/// What to produce.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Conversion {
    /// Office document or HTML -> PDF.
    ToPdf,
    /// PDF -> PowerPoint (pages become slides with editable text boxes).
    PdfToPptx,
    /// PDF -> PDF/A-2b (archival).
    PdfToPdfA,
}

impl Conversion {
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "to-pdf" => Some(Self::ToPdf),
            "pdf-to-pptx" => Some(Self::PdfToPptx),
            "pdf-to-pdfa" => Some(Self::PdfToPdfA),
            _ => None,
        }
    }
}

#[derive(Debug, PartialEq, Eq)]
enum Container {
    Zip,
    Ole,
    Rtf,
    Pdf,
    Html,
}

fn sniff(bytes: &[u8]) -> Option<Container> {
    if bytes.starts_with(b"PK\x03\x04") {
        return Some(Container::Zip);
    }
    if bytes.starts_with(&[0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]) {
        return Some(Container::Ole);
    }
    if bytes.starts_with(b"{\\rtf") {
        return Some(Container::Rtf);
    }
    if crate::compress::has_pdf_header(bytes) {
        return Some(Container::Pdf);
    }
    // HTML: optional UTF-8 BOM and whitespace, then a tag.
    let text = bytes.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(bytes);
    let start = text.iter().position(|b| !b.is_ascii_whitespace())?;
    let head = String::from_utf8_lossy(&text[start..text.len().min(start + 4096)]).to_ascii_lowercase();
    if head.starts_with('<') && (head.contains("<html") || head.contains("<!doctype html") || head.contains("<body") || head.contains("<p") || head.contains("<div")) {
        return Some(Container::Html);
    }
    None
}

/// Checks that the content matches the claimed extension (extensions alone prove nothing).
pub fn validate_input(bytes: &[u8], extension: &str, conversion: Conversion) -> Result<(), AppError> {
    let container = sniff(bytes);
    let matches = match (conversion, extension) {
        (Conversion::PdfToPptx | Conversion::PdfToPdfA, "pdf") => container == Some(Container::Pdf),
        (Conversion::ToPdf, "docx" | "odt" | "pptx" | "odp" | "xlsx" | "ods") => container == Some(Container::Zip),
        // Some ".doc" files are really RTF; LibreOffice handles both.
        (Conversion::ToPdf, "doc") => matches!(container, Some(Container::Ole | Container::Rtf)),
        (Conversion::ToPdf, "ppt" | "xls") => container == Some(Container::Ole),
        (Conversion::ToPdf, "rtf") => container == Some(Container::Rtf),
        (Conversion::ToPdf, "html" | "htm") => container == Some(Container::Html),
        _ => return Err(AppError::new("unsupported", "This file type cannot be converted with this tool.")),
    };
    if matches {
        Ok(())
    } else {
        Err(AppError::new("not-document", "This file is damaged or is not the kind of document its name suggests."))
    }
}

static REMOTE_ATTRIBUTE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(?i)(\b(?:src|poster|background|data|lowsrc|longdesc|codebase|action|formaction)\s*=\s*["']?\s*)(?:https?:|ftp:|file:)?//"#).unwrap()
});
static REMOTE_LINK: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#"(?i)(<link\b[^>]*?\bhref\s*=\s*["']?\s*)(?:https?:|ftp:|file:)?//"#).unwrap());
static REMOTE_CSS: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#"(?i)(url\(\s*["']?\s*|@import\s+["']\s*)(?:https?:|ftp:|file:)?//"#).unwrap());
static REFRESH: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#"(?i)(content\s*=\s*["'][^"']*?url\s*=\s*)(?:https?:|ftp:|file:)?//"#).unwrap());
static SRCSET: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#"(?i)\bsrcset\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)"#).unwrap());

/// Neutralises every reference that would make LibreOffice fetch something from the network
/// (images, stylesheets, frames, refresh redirects). Ordinary <a href> links are kept so they
/// stay clickable in the PDF; they are never fetched during conversion.
pub fn neutralize_remote_references(html: &[u8]) -> Vec<u8> {
    let blocked: &[u8] = b"${1}about:invalid#";
    let html = SRCSET.replace_all(html, &b""[..]);
    let html = REMOTE_ATTRIBUTE.replace_all(&html, blocked);
    let html = REMOTE_LINK.replace_all(&html, blocked);
    let html = REMOTE_CSS.replace_all(&html, blocked);
    REFRESH.replace_all(&html, blocked).into_owned()
}

/// `file:///` URL for LibreOffice's -env:UserInstallation, percent-encoding anything unusual.
pub fn file_url(path: &Path) -> String {
    let text = path.display().to_string().replace('\\', "/");
    let mut url = String::from(if text.starts_with('/') { "file://" } else { "file:///" });
    for byte in text.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' | b'/' | b':' => url.push(byte as char),
            _ => url.push_str(&format!("%{byte:02X}")),
        }
    }
    url
}

fn ensure_profile(profile_dir: &Path) -> Result<(), AppError> {
    let settings = profile_dir.join("user").join("registrymodifications.xcu");
    if !settings.exists() {
        std::fs::create_dir_all(settings.parent().expect("settings path has a parent"))?;
        std::fs::write(&settings, PROFILE_SETTINGS)?;
    }
    Ok(())
}

/// True if the PDF declares PDF/A conformance in its XMP metadata.
pub fn declares_pdfa(pdf: &[u8]) -> bool {
    pdf.windows(11).any(|window| window == b"pdfaid:part")
}

pub fn convert(
    soffice: &Path,
    profile_dir: &Path,
    input: &[u8],
    extension: &str,
    conversion: Conversion,
    cancel: &AtomicBool,
    timeout: Duration,
) -> Result<Vec<u8>, AppError> {
    validate_input(input, extension, conversion)?;
    let input: Vec<u8> = if matches!(extension, "html" | "htm") { neutralize_remote_references(input) } else { input.to_vec() };

    // Fixed, safe file names inside a private temp folder: the user's file name never reaches
    // the command line, and the folder (with its copy of the document) is removed afterwards.
    let _guard = SOFFICE_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    ensure_profile(profile_dir)?;
    with_temp_dir("doccraft-convert-", |work| {
        let input_path = work.join(format!("document.{extension}"));
        let out_dir = work.join("out");
        std::fs::write(&input_path, &input)?;
        std::fs::create_dir(&out_dir)?;

        let (filter_args, target, output_name): (&[&str], &str, &str) = match conversion {
            Conversion::ToPdf => (&[], "pdf", "document.pdf"),
            Conversion::PdfToPptx => (&["--infilter=impress_pdf_import"], "pptx", "document.pptx"),
            Conversion::PdfToPdfA => (
                &["--infilter=draw_pdf_import"],
                r#"pdf:draw_pdf_Export:{"SelectPdfVersion":{"type":"long","value":"2"}}"#,
                "document.pdf",
            ),
        };

        let mut command = quiet_command(soffice);
        command
            .arg(format!("-env:UserInstallation={}", file_url(profile_dir)))
            .args(["--headless", "--invisible", "--norestore", "--nologo", "--nodefault", "--nolockcheck"])
            .args(filter_args)
            .args(["--convert-to", target, "--outdir"])
            .arg(&out_dir)
            .arg(&input_path);

        match run(command, timeout, cancel) {
            Ok(_) => {}
            Err(RunError::Cancelled) => return Err(AppError::cancelled()),
            Err(RunError::TimedOut) => {
                return Err(AppError::new("timeout", "LibreOffice took too long to convert this document and was stopped."));
            }
            Err(RunError::Spawn) => {
                return Err(AppError::new("engine-missing", "LibreOffice could not be started. Check that it is installed correctly."));
            }
        }

        // LibreOffice can exit successfully without producing output, so check the file itself.
        let output = std::fs::read(out_dir.join(output_name)).map_err(|_| conversion_failed())?;
        let valid = match conversion {
            Conversion::PdfToPptx => output.starts_with(b"PK\x03\x04"),
            Conversion::ToPdf => crate::compress::has_pdf_header(&output),
            Conversion::PdfToPdfA => crate::compress::has_pdf_header(&output) && declares_pdfa(&output),
        };
        if !valid {
            return Err(conversion_failed());
        }
        Ok(output)
    })
}

fn conversion_failed() -> AppError {
    AppError::new(
        "conversion-failed",
        "LibreOffice could not convert this document. It may be damaged, password-protected or use features LibreOffice does not support.",
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(name: &str) -> Vec<u8> {
        std::fs::read(format!("{}/tests/fixtures/{name}", env!("CARGO_MANIFEST_DIR"))).unwrap()
    }

    fn run_with_libreoffice(input: &[u8], extension: &str, conversion: Conversion) -> Option<Result<Vec<u8>, AppError>> {
        let Some(soffice) = crate::engines::find_soffice() else {
            eprintln!("skipped: LibreOffice not installed");
            return None;
        };
        let profile = tempfile::tempdir().unwrap();
        Some(convert(&soffice, profile.path(), input, extension, conversion, &AtomicBool::new(false), CONVERSION_TIMEOUT))
    }

    fn pdf_text(pdf: &[u8]) -> (usize, String) {
        let doc = lopdf::Document::load_mem(pdf).unwrap();
        let pages = doc.get_pages().len();
        (pages, doc.extract_text(&[1]).unwrap_or_default())
    }

    #[test]
    fn validates_signatures_per_type() {
        assert!(validate_input(b"PK\x03\x04rest", "docx", Conversion::ToPdf).is_ok());
        assert!(validate_input(b"PK\x03\x04rest", "pptx", Conversion::ToPdf).is_ok());
        assert!(validate_input(b"PK\x03\x04rest", "xlsx", Conversion::ToPdf).is_ok());
        assert!(validate_input(&[0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1, 0], "xls", Conversion::ToPdf).is_ok());
        assert!(validate_input(b"{\\rtf1 hello}", "doc", Conversion::ToPdf).is_ok());
        assert!(validate_input(b"\xEF\xBB\xBF  <!DOCTYPE html><html><body>x</body></html>", "html", Conversion::ToPdf).is_ok());
        assert!(validate_input(b"%PDF-1.7", "pdf", Conversion::PdfToPdfA).is_ok());
        assert_eq!(validate_input(b"%PDF-1.7", "docx", Conversion::ToPdf).unwrap_err().code, "not-document");
        assert_eq!(validate_input(b"hello there", "html", Conversion::ToPdf).unwrap_err().code, "not-document");
        assert_eq!(validate_input(b"PK\x03\x04", "exe", Conversion::ToPdf).unwrap_err().code, "unsupported");
        assert_eq!(validate_input(b"PK\x03\x04", "docx", Conversion::PdfToPptx).unwrap_err().code, "unsupported");
    }

    #[test]
    fn neutralizes_remote_references_but_keeps_links() {
        let html = br#"<html><head><link rel="stylesheet" href="https://cdn.example.com/a.css"><style>@import "http://x/y.css"; body{background:url('//x/bg.png')}</style>
<meta http-equiv="refresh" content="0; url=https://evil.example/"></head>
<body><img src="https://tracker.example/pixel.gif"><img src=//x/a.png srcset="https://x/1.png 1x, https://x/2.png 2x">
<iframe src="http://x/frame"></iframe><a href="https://example.com/docs">Docs</a><img src="local.png"></body></html>"#;
        let cleaned = String::from_utf8(neutralize_remote_references(html)).unwrap();
        for remote in ["https://cdn", "http://x/y.css", "//x/bg.png", "https://evil", "https://tracker", "//x/a.png", "https://x/1.png", "http://x/frame"] {
            assert!(!cleaned.contains(remote), "still contains {remote}: {cleaned}");
        }
        assert!(cleaned.contains(r#"<a href="https://example.com/docs">"#), "links must stay clickable");
        assert!(cleaned.contains(r#"src="local.png""#), "relative references are untouched");
    }

    #[test]
    fn builds_file_urls() {
        assert_eq!(file_url(Path::new("C:\\Users\\A B\\profile")), "file:///C:/Users/A%20B/profile");
        assert_eq!(file_url(Path::new("/home/me/profile")), "file:///home/me/profile");
    }

    #[test]
    fn converts_word_to_pdf() {
        let Some(result) = run_with_libreoffice(&fixture("sample.docx"), "docx", Conversion::ToPdf) else { return };
        let (pages, text) = pdf_text(&result.unwrap());
        assert!(pages >= 2, "page break should produce at least two pages");
        assert!(text.contains("DocCraft"), "first page text: {text}");
    }

    #[test]
    fn converts_excel_and_powerpoint_to_pdf() {
        for (name, extension, expected) in [("sample.xlsx", "xlsx", "Pears"), ("sample.pptx", "pptx", "DocCraft")] {
            let Some(result) = run_with_libreoffice(&fixture(name), extension, Conversion::ToPdf) else { return };
            let (pages, text) = pdf_text(&result.unwrap_or_else(|e| panic!("{name}: {e:?}")));
            assert!(pages >= 1);
            assert!(text.contains(expected), "{name} text: {text}");
        }
    }

    #[test]
    fn converts_html_to_pdf_offline() {
        let html = br#"<!DOCTYPE html><html><body><h1>DocCraft HTML</h1><p>Converted offline.</p><img src="https://example.invalid/x.png"></body></html>"#;
        let Some(result) = run_with_libreoffice(html, "html", Conversion::ToPdf) else { return };
        let (_, text) = pdf_text(&result.unwrap());
        assert!(text.contains("DocCraft HTML"), "text: {text}");
    }

    #[test]
    fn converts_pdf_to_pptx_and_pdfa() {
        let Some(word) = run_with_libreoffice(&fixture("sample.docx"), "docx", Conversion::ToPdf) else { return };
        let pdf = word.unwrap();
        let pptx = run_with_libreoffice(&pdf, "pdf", Conversion::PdfToPptx).unwrap().unwrap();
        assert!(pptx.starts_with(b"PK\x03\x04"));
        let pdfa = run_with_libreoffice(&pdf, "pdf", Conversion::PdfToPdfA).unwrap().unwrap();
        assert!(declares_pdfa(&pdfa), "output must declare PDF/A in XMP");
        let (pages, _) = pdf_text(&pdfa);
        assert_eq!(pages, lopdf::Document::load_mem(&pdf).unwrap().get_pages().len());
    }

    #[test]
    fn reports_corrupt_documents_as_conversion_failures() {
        let junk = b"PK\x03\x04 this is not really a docx".to_vec();
        let Some(result) = run_with_libreoffice(&junk, "docx", Conversion::ToPdf) else { return };
        assert_eq!(result.unwrap_err().code, "conversion-failed");
    }
}
