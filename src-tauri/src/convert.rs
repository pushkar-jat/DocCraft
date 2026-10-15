//! DOCX/DOC/ODT/RTF -> PDF through a locally installed LibreOffice running headless.

use std::path::Path;
use std::sync::atomic::AtomicBool;
use std::sync::Mutex;
use std::time::Duration;

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

#[derive(Debug, PartialEq, Eq)]
enum Container {
    Zip,
    Ole,
    Rtf,
}

fn sniff(bytes: &[u8]) -> Option<Container> {
    if bytes.starts_with(b"PK\x03\x04") {
        Some(Container::Zip)
    } else if bytes.starts_with(&[0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]) {
        Some(Container::Ole)
    } else if bytes.starts_with(b"{\\rtf") {
        Some(Container::Rtf)
    } else {
        None
    }
}

/// Checks that the content matches the claimed extension (extensions alone prove nothing).
pub fn validate_document(bytes: &[u8], extension: &str) -> Result<(), AppError> {
    let container = sniff(bytes);
    let matches = match extension {
        "docx" | "odt" => container == Some(Container::Zip),
        // Some ".doc" files are really RTF; LibreOffice handles both.
        "doc" => matches!(container, Some(Container::Ole | Container::Rtf)),
        "rtf" => container == Some(Container::Rtf),
        _ => return Err(AppError::new("unsupported", "Only DOCX, DOC, ODT and RTF documents can be converted.")),
    };
    if matches {
        Ok(())
    } else {
        Err(AppError::new("not-document", "This file is damaged or is not the kind of document its name suggests."))
    }
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

pub fn word_to_pdf(
    soffice: &Path,
    profile_dir: &Path,
    input: &[u8],
    extension: &str,
    cancel: &AtomicBool,
    timeout: Duration,
) -> Result<Vec<u8>, AppError> {
    validate_document(input, extension)?;

    // Fixed, safe file names inside a private temp folder: the user's file name never reaches
    // the command line, and the folder (with its copy of the document) is removed afterwards.
    let _guard = SOFFICE_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    ensure_profile(profile_dir)?;
    with_temp_dir("doccraft-convert-", |work| {
        let input_path = work.join(format!("document.{extension}"));
        let out_dir = work.join("out");
        std::fs::write(&input_path, input)?;
        std::fs::create_dir(&out_dir)?;

        let mut command = quiet_command(soffice);
        command
            .arg(format!("-env:UserInstallation={}", file_url(profile_dir)))
            .args(["--headless", "--invisible", "--norestore", "--nologo", "--nodefault", "--nolockcheck"])
            .args(["--convert-to", "pdf:writer_pdf_Export", "--outdir"])
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
        let output = std::fs::read(out_dir.join("document.pdf")).map_err(|_| conversion_failed())?;
        if !crate::compress::has_pdf_header(&output) {
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

    #[test]
    fn validates_document_signatures() {
        assert!(validate_document(b"PK\x03\x04rest", "docx").is_ok());
        assert!(validate_document(b"{\\rtf1 hello}", "rtf").is_ok());
        assert!(validate_document(b"{\\rtf1 hello}", "doc").is_ok());
        assert_eq!(validate_document(b"%PDF-1.7", "docx").unwrap_err().code, "not-document");
        assert_eq!(validate_document(b"PK\x03\x04", "exe").unwrap_err().code, "unsupported");
    }

    #[test]
    fn builds_file_urls() {
        assert_eq!(file_url(Path::new("C:\\Users\\A B\\profile")), "file:///C:/Users/A%20B/profile");
        assert_eq!(file_url(Path::new("/home/me/profile")), "file:///home/me/profile");
    }

    /// Real conversion through the locally installed LibreOffice. Skips when it is not installed.
    #[test]
    fn converts_a_docx_with_libreoffice_when_installed() {
        let Some(soffice) = crate::engines::find_soffice() else {
            eprintln!("skipped: LibreOffice not installed");
            return;
        };
        let fixture = std::fs::read(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/sample.docx")).unwrap();
        let profile = tempfile::tempdir().unwrap();
        let pdf = word_to_pdf(&soffice, profile.path(), &fixture, "docx", &AtomicBool::new(false), CONVERSION_TIMEOUT).unwrap();
        let doc = lopdf::Document::load_mem(&pdf).unwrap();
        assert!(doc.get_pages().len() >= 2, "page break should produce at least two pages");
        let text = doc.extract_text(&[1]).unwrap();
        assert!(text.contains("DocCraft"), "first page text: {text}");
    }

    #[test]
    fn reports_corrupt_documents_as_conversion_failures() {
        let Some(soffice) = crate::engines::find_soffice() else {
            eprintln!("skipped: LibreOffice not installed");
            return;
        };
        let profile = tempfile::tempdir().unwrap();
        let junk = b"PK\x03\x04 this is not really a docx".to_vec();
        let error = word_to_pdf(&soffice, profile.path(), &junk, "docx", &AtomicBool::new(false), CONVERSION_TIMEOUT).unwrap_err();
        assert_eq!(error.code, "conversion-failed");
    }
}
