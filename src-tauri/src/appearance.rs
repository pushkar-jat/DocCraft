// Native look: the Windows 11 Mica window backdrop and the user's Windows accent colour.
// On other systems (and Windows 10) the window stays opaque and the UI keeps its built-in colours.

use serde::Serialize;

/// The Windows accent palette as `#rrggbb` strings (as Windows computes it for the chosen accent).
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AccentPalette {
    pub accent: String,
    pub dark1: String,
    pub dark2: String,
    pub light1: String,
    pub light2: String,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct WindowAppearance {
    /// True when the window was created with the Mica backdrop (Windows 11), so the page may be translucent.
    pub mica: bool,
    pub accent: Option<AccentPalette>,
}

/// Mica needs Windows 11 (build 22000 or later).
pub fn supports_mica() -> bool {
    #[cfg(windows)]
    {
        windows_build().is_some_and(|build| build >= 22000)
    }
    #[cfg(not(windows))]
    {
        false
    }
}

#[cfg(windows)]
fn windows_build() -> Option<u32> {
    use windows::Wdk::System::SystemServices::RtlGetVersion;
    use windows::Win32::System::SystemInformation::OSVERSIONINFOW;

    let mut info = OSVERSIONINFOW { dwOSVersionInfoSize: std::mem::size_of::<OSVERSIONINFOW>() as u32, ..Default::default() };
    // SAFETY: `info` is a valid, correctly sized OSVERSIONINFOW for the call to fill in.
    let status = unsafe { RtlGetVersion(&mut info) };
    status.is_ok().then_some(info.dwBuildNumber)
}

/// Reads the accent palette from Windows' personalization settings. None if unavailable.
pub fn accent_palette() -> Option<AccentPalette> {
    #[cfg(windows)]
    {
        use windows::UI::Color;
        use windows::UI::ViewManagement::{UIColorType, UISettings};
        use windows::Win32::System::WinRT::{RO_INIT_MULTITHREADED, RoInitialize};

        // WinRT needs an initialized apartment on this worker thread; "already initialized" is fine.
        // SAFETY: RoInitialize has no preconditions beyond being called on the current thread.
        let _ = unsafe { RoInitialize(RO_INIT_MULTITHREADED) };
        let settings = UISettings::new().ok()?;
        let hex = |kind: UIColorType| -> Option<String> {
            let Color { R, G, B, .. } = settings.GetColorValue(kind).ok()?;
            Some(format!("#{R:02x}{G:02x}{B:02x}"))
        };
        Some(AccentPalette {
            accent: hex(UIColorType::Accent)?,
            dark1: hex(UIColorType::AccentDark1)?,
            dark2: hex(UIColorType::AccentDark2)?,
            light1: hex(UIColorType::AccentLight1)?,
            light2: hex(UIColorType::AccentLight2)?,
        })
    }
    #[cfg(not(windows))]
    {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_system_accent_as_hex_colours() {
        let Some(palette) = accent_palette() else {
            println!("skipped: no accent colour API on this system");
            return;
        };
        for colour in [&palette.accent, &palette.dark1, &palette.dark2, &palette.light1, &palette.light2] {
            assert!(colour.len() == 7 && colour.starts_with('#') && colour[1..].chars().all(|c| c.is_ascii_hexdigit()), "{colour}");
        }
        println!("accent palette: {palette:?}, mica supported: {}", supports_mica());
    }
}
