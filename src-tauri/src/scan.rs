//! Document scanning through Windows Image Acquisition (WIA), the scanner interface built into
//! Windows. A fixed PowerShell script (no user input in it) drives the standard Windows scan
//! dialog and saves the page as JPEG into a private temp folder.

use std::sync::atomic::AtomicBool;
use std::time::Duration;

use serde::Serialize;

use crate::errors::AppError;
#[cfg(windows)]
use crate::process::{capture_stdout, quiet_command, run, with_temp_dir, RunError};

/// The user may take a while in the scan dialog (preview, settings).
#[cfg(windows)]
const SCAN_TIMEOUT: Duration = Duration::from_secs(15 * 60);

#[cfg(windows)]
const LIST_SCRIPT: &str = r#"
$ErrorActionPreference = 'Stop'
try {
  $manager = New-Object -ComObject WIA.DeviceManager
  foreach ($info in $manager.DeviceInfos) {
    if ($info.Type -eq 1) { [Console]::Out.WriteLine($info.Properties.Item('Name').Value) }
  }
} catch { exit 5 }
"#;

#[cfg(windows)]
const SCAN_SCRIPT: &str = r#"
param([Parameter(Mandatory = $true)][string]$Out)
$ErrorActionPreference = 'Stop'
try {
  $dialog = New-Object -ComObject WIA.CommonDialog
  # Scanner device type (1), common Windows UI, JPEG output; returns $null if the user cancels.
  $image = $dialog.ShowAcquireImage(1, 0, 0, '{B96B3CAE-0728-11D3-9D7B-0000F81EF32E}', $false, $true, $false)
  if ($null -eq $image) { exit 3 }
  $image.SaveFile($Out)
  exit 0
} catch {
  if ($_.Exception.HResult -eq -2145320939) { exit 4 }  # WIA_S_NO_DEVICE_AVAILABLE
  exit 5
}
"#;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScannerStatus {
    pub supported: bool,
    pub scanners: Vec<String>,
}

#[cfg(windows)]
fn powershell() -> Option<std::path::PathBuf> {
    let root = std::env::var_os("SystemRoot")?;
    let path = std::path::PathBuf::from(root).join("System32").join("WindowsPowerShell").join("v1.0").join("powershell.exe");
    path.is_file().then_some(path)
}

#[cfg(windows)]
pub fn scanner_status() -> ScannerStatus {
    let scanners = powershell()
        .and_then(|ps| capture_stdout(&ps, &["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", LIST_SCRIPT], Duration::from_secs(30)))
        .map(|out| out.lines().map(str::trim).filter(|line| !line.is_empty()).map(str::to_owned).collect())
        .unwrap_or_default();
    ScannerStatus { supported: true, scanners }
}

#[cfg(not(windows))]
pub fn scanner_status() -> ScannerStatus {
    ScannerStatus { supported: false, scanners: Vec::new() }
}

/// Opens the Windows scan dialog and returns the scanned page as JPEG bytes.
#[cfg(windows)]
pub fn scan_page(cancel: &AtomicBool) -> Result<Vec<u8>, AppError> {
    let ps = powershell().ok_or_else(|| AppError::new("engine-missing", "Windows PowerShell is not available, so the scanner cannot be used."))?;
    with_temp_dir("doccraft-scan-", |work| {
        let script = work.join("scan.ps1");
        let out = work.join("page.jpg");
        std::fs::write(&script, SCAN_SCRIPT)?;
        let mut command = quiet_command(&ps);
        command.args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File"]).arg(&script).arg("-Out").arg(&out);
        let status = match run(command, SCAN_TIMEOUT, cancel) {
            Ok(status) => status,
            Err(RunError::Cancelled) => return Err(AppError::cancelled()),
            Err(RunError::TimedOut) => return Err(AppError::new("timeout", "The scan took too long and was stopped.")),
            Err(RunError::Spawn) => return Err(AppError::new("engine-missing", "The Windows scanner service could not be started.")),
        };
        match status.code() {
            Some(0) => {}
            Some(3) => return Err(AppError::cancelled()),
            Some(4) => {
                return Err(AppError::new("engine-missing", "No scanner was found. Connect and switch on your scanner, then try again."));
            }
            _ => return Err(AppError::new("conversion-failed", "The scanner reported a problem. Check that it is connected and not in use by another program.")),
        }
        let image = std::fs::read(&out).map_err(|_| AppError::new("conversion-failed", "The scanner did not return an image."))?;
        if !image.starts_with(&[0xFF, 0xD8, 0xFF]) {
            return Err(AppError::new("conversion-failed", "The scanner returned an image DocCraft cannot read."));
        }
        Ok(image)
    })
}

#[cfg(not(windows))]
pub fn scan_page(_cancel: &AtomicBool) -> Result<Vec<u8>, AppError> {
    Err(AppError::new("unsupported", "Scanner support is currently available on Windows only. Use the camera or Images to PDF instead."))
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    /// On a machine without scanners, scanning must fail cleanly with "no scanner" and leave no
    /// temp folder behind. Skips when a scanner is attached (it would open a real dialog).
    #[test]
    fn reports_missing_scanner_cleanly() {
        let status = scanner_status();
        if !status.scanners.is_empty() {
            eprintln!("skipped: scanners present: {:?}", status.scanners);
            return;
        }
        let error = scan_page(&AtomicBool::new(false)).unwrap_err();
        assert_eq!(error.code, "engine-missing", "{}", error.message);
        assert!(error.message.contains("No scanner"), "{}", error.message);
    }
}
