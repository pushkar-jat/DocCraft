//! Detects locally installed conversion engines. DocCraft does not bundle them.

use std::path::PathBuf;
use std::time::Duration;

use serde::Serialize;

use crate::process::{capture_stdout, find_executable};

#[derive(Debug, Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct EngineInfo {
    pub available: bool,
    /// Location of the engine executable (not a user document).
    pub path: Option<String>,
    pub version: Option<String>,
    /// OCR languages; empty for engines without languages.
    pub languages: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineStatus {
    pub libre_office: EngineInfo,
    pub tesseract: EngineInfo,
}

fn env_path(var: &str) -> Option<PathBuf> {
    std::env::var_os(var).map(PathBuf::from)
}

pub fn find_soffice() -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if cfg!(windows) {
        for var in ["ProgramFiles", "ProgramW6432", "ProgramFiles(x86)"] {
            if let Some(base) = env_path(var) {
                candidates.push(base.join("LibreOffice").join("program").join("soffice.exe"));
            }
        }
        find_executable(&candidates, &["soffice.exe"])
    } else if cfg!(target_os = "macos") {
        candidates.push(PathBuf::from("/Applications/LibreOffice.app/Contents/MacOS/soffice"));
        find_executable(&candidates, &["soffice"])
    } else {
        for path in ["/usr/bin/soffice", "/usr/lib/libreoffice/program/soffice", "/opt/libreoffice/program/soffice", "/snap/bin/libreoffice"] {
            candidates.push(PathBuf::from(path));
        }
        find_executable(&candidates, &["soffice", "libreoffice"])
    }
}

pub fn find_tesseract() -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if cfg!(windows) {
        for var in ["ProgramFiles", "ProgramW6432", "ProgramFiles(x86)"] {
            if let Some(base) = env_path(var) {
                candidates.push(base.join("Tesseract-OCR").join("tesseract.exe"));
            }
        }
        if let Some(local) = env_path("LOCALAPPDATA") {
            candidates.push(local.join("Programs").join("Tesseract-OCR").join("tesseract.exe"));
        }
        find_executable(&candidates, &["tesseract.exe"])
    } else {
        for path in ["/opt/homebrew/bin/tesseract", "/usr/local/bin/tesseract", "/usr/bin/tesseract"] {
            candidates.push(PathBuf::from(path));
        }
        find_executable(&candidates, &["tesseract"])
    }
}

/// Language codes are passed to Tesseract as a separate argument; still only accept plain identifiers.
pub fn is_valid_language_code(code: &str) -> bool {
    !code.is_empty() && code.len() <= 64 && code.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
}

/// Parses `tesseract --list-langs` output, dropping the header and the non-language `osd` model.
pub fn parse_language_list(output: &str) -> Vec<String> {
    output
        .lines()
        .skip_while(|line| !line.to_ascii_lowercase().contains("list of available languages"))
        .skip(1)
        .map(str::trim)
        .filter(|code| *code != "osd" && is_valid_language_code(code))
        .map(str::to_owned)
        .collect()
}

pub fn status() -> EngineStatus {
    let libre_office = match find_soffice() {
        Some(path) => EngineInfo { available: true, path: Some(path.display().to_string()), ..Default::default() },
        None => EngineInfo::default(),
    };

    let tesseract = match find_tesseract() {
        Some(path) => {
            let timeout = Duration::from_secs(15);
            let version = capture_stdout(&path, &["--version"], timeout)
                .and_then(|text| text.lines().next().map(|line| line.trim().to_owned()));
            let languages = capture_stdout(&path, &["--list-langs"], timeout)
                .map(|text| parse_language_list(&text))
                .unwrap_or_default();
            EngineInfo {
                // A Tesseract without any language data cannot recognise anything.
                available: !languages.is_empty(),
                path: Some(path.display().to_string()),
                version,
                languages,
            }
        }
        None => EngineInfo::default(),
    };

    EngineStatus { libre_office, tesseract }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_tesseract_language_list() {
        let output = "List of available languages in \"C:\\Program Files\\Tesseract-OCR/tessdata/\" (3):\neng\nosd\ndeu\n";
        assert_eq!(parse_language_list(output), vec!["eng", "deu"]);
    }

    #[test]
    fn rejects_suspicious_language_codes() {
        assert!(is_valid_language_code("eng"));
        assert!(is_valid_language_code("chi_sim"));
        assert!(!is_valid_language_code(""));
        assert!(!is_valid_language_code("eng --tessdata-dir x"));
        assert!(!is_valid_language_code("../eng"));
    }
}
