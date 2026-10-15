//! Image -> searchable PDF (image plus invisible text layer) through a locally installed Tesseract.

use std::path::Path;
use std::sync::atomic::AtomicBool;
use std::time::Duration;

use crate::engines::is_valid_language_code;
use crate::errors::AppError;
use crate::process::{quiet_command, run, with_temp_dir, RunError};

pub const OCR_TIMEOUT: Duration = Duration::from_secs(300);

pub fn image_extension(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some("jpg")
    } else if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("png")
    } else {
        None
    }
}

/// `languages` is a list like ["eng", "deu"]; each code must be installed (checked by the caller).
pub fn ocr_image_to_pdf(
    tesseract: &Path,
    image: &[u8],
    languages: &[String],
    dpi: Option<u32>,
    cancel: &AtomicBool,
    timeout: Duration,
) -> Result<Vec<u8>, AppError> {
    let extension = image_extension(image)
        .ok_or_else(|| AppError::new("invalid-image", "This file is not a valid JPEG or PNG image."))?;
    if languages.is_empty() || !languages.iter().all(|code| is_valid_language_code(code)) {
        return Err(AppError::bad_request("OCR language"));
    }

    with_temp_dir("doccraft-ocr-", |work| {
        let input_path = work.join(format!("page.{extension}"));
        let output_base = work.join("result");
        std::fs::write(&input_path, image)?;

        let mut command = quiet_command(tesseract);
        command.arg(&input_path).arg(&output_base).args(["-l", &languages.join("+")]);
        if let Some(dpi) = dpi.filter(|dpi| (70..=1200).contains(dpi)) {
            command.args(["--dpi", &dpi.to_string()]);
        }
        command.arg("pdf");

        match run(command, timeout, cancel) {
            Ok(status) if status.success() => {}
            Ok(_) => return Err(AppError::new("conversion-failed", "Tesseract could not read this image.")),
            Err(RunError::Cancelled) => return Err(AppError::cancelled()),
            Err(RunError::TimedOut) => return Err(AppError::new("timeout", "OCR took too long on this page and was stopped.")),
            Err(RunError::Spawn) => {
                return Err(AppError::new("engine-missing", "Tesseract could not be started. Check that it is installed correctly."));
            }
        }

        let pdf = std::fs::read(output_base.with_extension("pdf"))
            .map_err(|_| AppError::new("conversion-failed", "Tesseract did not produce a PDF for this image."))?;
        if !crate::compress::has_pdf_header(&pdf) {
            return Err(AppError::new("conversion-failed", "Tesseract produced an invalid PDF for this image."));
        }
        Ok(pdf)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use ab_glyph::{Font, FontRef, PxScale, ScaleFont};
    use image::{GrayImage, Luma};

    #[test]
    fn detects_image_types() {
        assert_eq!(image_extension(&[0xFF, 0xD8, 0xFF, 0xE0]), Some("jpg"));
        assert_eq!(image_extension(b"\x89PNG\r\n\x1a\nrest"), Some("png"));
        assert_eq!(image_extension(b"GIF89a"), None);
    }

    /// Renders black text on white with a system font, as a stand-in for a scanned page.
    fn render_text_png(text: &str) -> Option<Vec<u8>> {
        let font_data = std::fs::read("C:\\Windows\\Fonts\\arial.ttf")
            .or_else(|_| std::fs::read("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"))
            .or_else(|_| std::fs::read("/System/Library/Fonts/Supplemental/Arial.ttf"))
            .ok()?;
        let font = FontRef::try_from_slice(&font_data).ok()?;
        let scale = PxScale::from(64.0);
        let scaled = font.as_scaled(scale);
        let mut image = GrayImage::from_pixel(1400, 300, Luma([255]));
        let mut x = 60.0;
        for character in text.chars() {
            let glyph = scaled.scaled_glyph(character);
            let advance = scaled.h_advance(glyph.id);
            let mut glyph = glyph;
            glyph.position = ab_glyph::point(x, 150.0);
            if let Some(outlined) = font.outline_glyph(glyph) {
                let bounds = outlined.px_bounds();
                outlined.draw(|gx, gy, coverage| {
                    let px = bounds.min.x as i32 + gx as i32;
                    let py = bounds.min.y as i32 + gy as i32;
                    if px >= 0 && py >= 0 && (px as u32) < image.width() && (py as u32) < image.height() {
                        let value = (255.0 * (1.0 - coverage)) as u8;
                        let pixel = image.get_pixel_mut(px as u32, py as u32);
                        pixel.0[0] = pixel.0[0].min(value);
                    }
                });
            }
            x += advance;
        }
        let mut png = Vec::new();
        image.write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png).ok()?;
        Some(png)
    }

    /// Real OCR through the locally installed Tesseract. Skips when Tesseract or a font is missing.
    #[test]
    fn produces_a_searchable_pdf_when_tesseract_is_installed() {
        let Some(tesseract) = crate::engines::find_tesseract() else {
            eprintln!("skipped: Tesseract not installed");
            return;
        };
        let Some(png) = render_text_png("DOCCRAFT OFFLINE SCAN 2026") else {
            eprintln!("skipped: no system font for the test image");
            return;
        };
        let pdf = ocr_image_to_pdf(&tesseract, &png, &["eng".to_owned()], Some(300), &AtomicBool::new(false), OCR_TIMEOUT).unwrap();
        let doc = lopdf::Document::load_mem(&pdf).unwrap();
        assert_eq!(doc.get_pages().len(), 1);
        let text = doc.extract_text(&[1]).unwrap().to_uppercase();
        assert!(text.contains("DOCCRAFT"), "recognised text: {text}");
        assert!(text.contains("OFFLINE"), "recognised text: {text}");
    }

    #[test]
    fn rejects_non_images_before_running_tesseract() {
        let error = ocr_image_to_pdf(Path::new("unused"), b"%PDF-1.7", &["eng".to_owned()], None, &AtomicBool::new(false), OCR_TIMEOUT)
            .unwrap_err();
        assert_eq!(error.code, "invalid-image");
    }
}
