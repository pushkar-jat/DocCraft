//! Local PDF optimisation with lopdf + image. Three presets map to concrete behaviour:
//!
//! - `high`: lossless only. Unused objects are dropped, Flate streams are re-deflated at the
//!   highest level, uncompressed streams are compressed, and objects are packed into object streams.
//! - `balanced`: lossless steps, plus JPEG photos re-encoded at quality 75 and any 8-bit
//!   RGB/grey image whose longest side exceeds 2500 px downscaled (lossless images stay lossless).
//! - `small`: lossless steps, plus every eligible 8-bit RGB/grey image re-encoded as JPEG at
//!   quality 55 and downscaled to at most 1600 px on its longest side.
//!
//! An image is only replaced when the new encoding is at least 5% smaller. Images with masks
//! used as stencils, Decode arrays, unusual colour spaces or other filters are left untouched.

use std::io::Write;
use std::sync::atomic::{AtomicBool, Ordering};

use flate2::write::ZlibEncoder;
use flate2::Compression;
use image::codecs::jpeg::JpegEncoder;
use image::imageops::FilterType;
use image::{ExtendedColorType, GrayImage, ImageFormat, RgbImage};
use lopdf::{Document, LoadOptions, Object, ObjectId, SaveOptions, Stream};

use crate::errors::AppError;

/// Upper bound for any single decompressed stream (guards against decompression bombs).
const MAX_STREAM_BYTES: usize = 256 * 1024 * 1024;
/// Upper bound for decoded image samples.
const MAX_IMAGE_SAMPLES: u64 = 120_000_000;
const MIN_SAVING: f64 = 0.95;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Preset {
    High,
    Balanced,
    Small,
}

impl Preset {
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "high" => Some(Self::High),
            "balanced" => Some(Self::Balanced),
            "small" => Some(Self::Small),
            _ => None,
        }
    }

    fn images(self) -> Option<ImageSettings> {
        match self {
            Self::High => None,
            Self::Balanced => Some(ImageSettings { max_side: 2500, quality: 75, lossless_to_jpeg: false }),
            Self::Small => Some(ImageSettings { max_side: 1600, quality: 55, lossless_to_jpeg: true }),
        }
    }
}

#[derive(Clone, Copy, Debug)]
struct ImageSettings {
    max_side: u32,
    quality: u8,
    /// Whether Flate (lossless) images may be converted to JPEG.
    lossless_to_jpeg: bool,
}

#[derive(Debug, Default, PartialEq, Eq)]
pub struct CompressStats {
    pub images_found: usize,
    pub images_reencoded: usize,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum SourceKind {
    Jpeg,
    Flate,
}

/// What we learned about an image XObject before touching it.
struct ImagePlan {
    components: u8,
    kind: SourceKind,
    width: u32,
    height: u32,
}

pub fn has_pdf_header(bytes: &[u8]) -> bool {
    bytes[..bytes.len().min(1024)].windows(5).any(|window| window == b"%PDF-")
}

/// Optimises `input` according to `preset`. Calls `progress(current, total)` per image.
pub fn compress_pdf(
    input: &[u8],
    preset: Preset,
    cancel: &AtomicBool,
    mut progress: impl FnMut(usize, usize),
) -> Result<(Vec<u8>, CompressStats), AppError> {
    let not_pdf = || AppError::new("not-pdf", "This file is damaged or is not a valid PDF.");
    if !has_pdf_header(input) {
        return Err(not_pdf());
    }
    let mut doc = Document::load_mem_with_options(input, LoadOptions::with_max_decompressed_size(MAX_STREAM_BYTES))
        .map_err(|error| match error {
            lopdf::Error::Decryption(_) | lopdf::Error::UnsupportedSecurityHandler(_) => encrypted_error(),
            _ => not_pdf(),
        })?;
    if doc.is_encrypted() || doc.trailer.has(b"Encrypt") {
        return Err(encrypted_error());
    }
    let page_count = doc.get_pages().len();
    if page_count == 0 {
        return Err(AppError::new("empty", "This PDF does not contain any pages."));
    }

    let mut stats = CompressStats::default();
    let image_ids: Vec<ObjectId> = doc
        .objects
        .iter()
        .filter_map(|(id, object)| match object {
            Object::Stream(stream) if is_image(stream) => Some(*id),
            _ => None,
        })
        .collect();
    stats.images_found = image_ids.len();

    if let Some(settings) = preset.images() {
        for (index, id) in image_ids.iter().enumerate() {
            check_cancel(cancel)?;
            progress(index + 1, image_ids.len());
            let Some(plan) = plan_image(&doc, *id) else { continue };
            if let Some(Object::Stream(stream)) = doc.objects.get_mut(id)
                && reencode_image(stream, &plan, settings)
            {
                stats.images_reencoded += 1;
            }
        }
    }

    // Lossless pass over every stream that is plain Flate without predictors.
    let stream_ids: Vec<ObjectId> = doc
        .objects
        .iter()
        .filter_map(|(id, object)| matches!(object, Object::Stream(_)).then_some(*id))
        .collect();
    for id in stream_ids {
        check_cancel(cancel)?;
        if let Some(Object::Stream(stream)) = doc.objects.get_mut(&id) {
            redeflate(stream);
        }
    }

    doc.prune_objects();
    doc.compress();
    check_cancel(cancel)?;

    let mut output = Vec::new();
    let options = SaveOptions::builder().use_object_streams(true).use_xref_streams(true).compression_level(9).build();
    doc.save_with_options(&mut output, options).map_err(|_| AppError::internal())?;

    // Safety net: never hand back something we cannot read again with the same page count.
    let check = Document::load_mem(&output).map_err(|_| AppError::internal())?;
    if check.get_pages().len() != page_count {
        return Err(AppError::internal());
    }
    Ok((output, stats))
}

fn encrypted_error() -> AppError {
    AppError::new(
        "encrypted",
        "This PDF is password-protected or encrypted. Remove the protection in a PDF reader you trust, then try again.",
    )
}

fn check_cancel(cancel: &AtomicBool) -> Result<(), AppError> {
    if cancel.load(Ordering::SeqCst) { Err(AppError::cancelled()) } else { Ok(()) }
}

fn is_image(stream: &Stream) -> bool {
    stream.dict.get(b"Subtype").and_then(Object::as_name).map(|name| name == b"Image").unwrap_or(false)
}

fn plan_image(doc: &Document, id: ObjectId) -> Option<ImagePlan> {
    let Ok(Object::Stream(stream)) = doc.get_object(id) else { return None };
    let dict = &stream.dict;
    let get_int = |key: &[u8]| -> Option<i64> {
        let object = dict.get(key).ok()?;
        doc.dereference(object).ok()?.1.as_i64().ok()
    };
    if dict.get(b"ImageMask").and_then(Object::as_bool).unwrap_or(false) || dict.has(b"Decode") {
        return None;
    }
    if get_int(b"BitsPerComponent")? != 8 {
        return None;
    }
    let width = u32::try_from(get_int(b"Width")?).ok()?;
    let height = u32::try_from(get_int(b"Height")?).ok()?;
    if width == 0 || height == 0 {
        return None;
    }
    let components = color_components(doc, dict.get(b"ColorSpace").ok()?)?;
    if u64::from(width) * u64::from(height) * u64::from(components) > MAX_IMAGE_SAMPLES {
        return None;
    }
    let filters = stream.filters().ok()?;
    let kind = match filters.as_slice() {
        [name] if *name == b"DCTDecode" => SourceKind::Jpeg,
        [name] if *name == b"FlateDecode" => SourceKind::Flate,
        _ => return None,
    };
    Some(ImagePlan { components, kind, width, height })
}

/// 1 for grey, 3 for RGB (including ICC-based equivalents); None for anything else.
fn color_components(doc: &Document, color_space: &Object) -> Option<u8> {
    let (_, color_space) = doc.dereference(color_space).ok()?;
    match color_space {
        Object::Name(name) if name == b"DeviceRGB" => Some(3),
        Object::Name(name) if name == b"DeviceGray" => Some(1),
        Object::Array(items) if items.len() == 2 && items[0].as_name().ok() == Some(b"ICCBased".as_slice()) => {
            let (_, profile) = doc.dereference(&items[1]).ok()?;
            let Object::Stream(profile) = profile else { return None };
            match profile.dict.get(b"N").and_then(Object::as_i64).ok()? {
                1 => Some(1),
                3 => Some(3),
                _ => None,
            }
        }
        _ => None,
    }
}

enum Pixels {
    Gray(GrayImage),
    Rgb(RgbImage),
}

impl Pixels {
    fn dimensions(&self) -> (u32, u32) {
        match self {
            Self::Gray(image) => image.dimensions(),
            Self::Rgb(image) => image.dimensions(),
        }
    }

    fn resized_to_fit(self, max_side: u32) -> (Self, bool) {
        let (width, height) = self.dimensions();
        let longest = width.max(height);
        if longest <= max_side {
            return (self, false);
        }
        let scale = f64::from(max_side) / f64::from(longest);
        let new_width = ((f64::from(width) * scale).round() as u32).max(1);
        let new_height = ((f64::from(height) * scale).round() as u32).max(1);
        let resized = match self {
            Self::Gray(image) => Self::Gray(image::imageops::resize(&image, new_width, new_height, FilterType::Triangle)),
            Self::Rgb(image) => Self::Rgb(image::imageops::resize(&image, new_width, new_height, FilterType::Triangle)),
        };
        (resized, true)
    }

    fn raw(&self) -> &[u8] {
        match self {
            Self::Gray(image) => image.as_raw(),
            Self::Rgb(image) => image.as_raw(),
        }
    }

    fn jpeg(&self, quality: u8) -> Option<Vec<u8>> {
        let (width, height) = self.dimensions();
        let color = match self {
            Self::Gray(_) => ExtendedColorType::L8,
            Self::Rgb(_) => ExtendedColorType::Rgb8,
        };
        let mut out = Vec::new();
        JpegEncoder::new_with_quality(&mut out, quality).encode(self.raw(), width, height, color).ok()?;
        Some(out)
    }
}

fn decode(stream: &Stream, plan: &ImagePlan) -> Option<Pixels> {
    match plan.kind {
        SourceKind::Jpeg => {
            let image = image::load_from_memory_with_format(&stream.content, ImageFormat::Jpeg).ok()?;
            if image.width() != plan.width || image.height() != plan.height {
                return None;
            }
            match (plan.components, image.color().channel_count()) {
                (1, 1) => Some(Pixels::Gray(image.into_luma8())),
                (3, 3) => Some(Pixels::Rgb(image.into_rgb8())),
                _ => None,
            }
        }
        SourceKind::Flate => {
            let data = stream.decompressed_content_with_limit(MAX_STREAM_BYTES).ok()?;
            let expected = plan.width as usize * plan.height as usize * plan.components as usize;
            if data.len() < expected {
                return None;
            }
            let data = data[..expected].to_vec();
            match plan.components {
                1 => GrayImage::from_raw(plan.width, plan.height, data).map(Pixels::Gray),
                _ => RgbImage::from_raw(plan.width, plan.height, data).map(Pixels::Rgb),
            }
        }
    }
}

fn deflate(data: &[u8]) -> Option<Vec<u8>> {
    let mut encoder = ZlibEncoder::new(Vec::new(), Compression::best());
    encoder.write_all(data).ok()?;
    encoder.finish().ok()
}

/// Re-encodes one image if that makes it meaningfully smaller. Returns true if replaced.
fn reencode_image(stream: &mut Stream, plan: &ImagePlan, settings: ImageSettings) -> bool {
    let Some(pixels) = decode(stream, plan) else { return false };
    let (pixels, resized) = pixels.resized_to_fit(settings.max_side);

    let to_jpeg = plan.kind == SourceKind::Jpeg || settings.lossless_to_jpeg;
    if !to_jpeg && !resized {
        return false; // Lossless image at an acceptable size: leave it to the lossless pass.
    }
    let (content, filter) = if to_jpeg {
        match pixels.jpeg(settings.quality) {
            Some(data) => (data, "DCTDecode"),
            None => return false,
        }
    } else {
        match deflate(pixels.raw()) {
            Some(data) => (data, "FlateDecode"),
            None => return false,
        }
    };
    if (content.len() as f64) > (stream.content.len() as f64) * MIN_SAVING {
        return false;
    }

    let (width, height) = pixels.dimensions();
    stream.dict.set("Filter", Object::Name(filter.as_bytes().to_vec()));
    stream.dict.remove(b"DecodeParms");
    stream.dict.set("Width", i64::from(width));
    stream.dict.set("Height", i64::from(height));
    stream.dict.set("BitsPerComponent", 8);
    stream.set_content(content);
    true
}

/// Re-deflates plain Flate streams (no predictor) at maximum compression when smaller.
fn redeflate(stream: &mut Stream) {
    let plain_flate = matches!(stream.filters().as_deref(), Ok([name]) if *name == b"FlateDecode");
    if !plain_flate || stream.dict.has(b"DecodeParms") {
        return;
    }
    let Ok(data) = stream.decompressed_content_with_limit(MAX_STREAM_BYTES) else { return };
    if let Some(recompressed) = deflate(&data)
        && recompressed.len() < stream.content.len()
    {
        stream.set_content(recompressed);
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use lopdf::{dictionary, Stream};

    /// A one-page PDF with an embedded JPEG photo of `width` x `height` pixels.
    pub(crate) fn pdf_with_jpeg(width: u32, height: u32) -> Vec<u8> {
        let mut pixels = RgbImage::new(width, height);
        for (x, y, pixel) in pixels.enumerate_pixels_mut() {
            // Smooth gradient with some texture so the JPEG is photo-like, not trivially small.
            let noise = ((x.wrapping_mul(7919) ^ y.wrapping_mul(104_729)) % 23) as u8;
            *pixel = image::Rgb([(x % 256) as u8 ^ noise, (y % 256) as u8, ((x + y) % 256) as u8]);
        }
        let mut jpeg = Vec::new();
        JpegEncoder::new_with_quality(&mut jpeg, 95)
            .encode(pixels.as_raw(), width, height, ExtendedColorType::Rgb8)
            .unwrap();
        let image = Stream::new(
            dictionary! {
                "Type" => "XObject", "Subtype" => "Image", "Width" => i64::from(width), "Height" => i64::from(height),
                "ColorSpace" => "DeviceRGB", "BitsPerComponent" => 8, "Filter" => "DCTDecode",
            },
            jpeg,
        );
        build_pdf(Some(image), b"q 500 0 0 333 50 400 cm /Im1 Do Q".to_vec())
    }

    /// A one-page PDF with an uncompressed, text-heavy content stream.
    pub(crate) fn pdf_with_text() -> Vec<u8> {
        let mut content = Vec::new();
        for line in 0..60 {
            content.extend_from_slice(format!("BT /F1 10 Tf 50 {} Td (DocCraft keeps documents local. Line {line}.) Tj ET\n", 800 - line * 12).as_bytes());
        }
        build_pdf(None, content)
    }

    fn build_pdf(image: Option<Stream>, content: Vec<u8>) -> Vec<u8> {
        let mut doc = Document::with_version("1.5");
        let pages_id = doc.new_object_id();
        let font_id = doc.add_object(dictionary! { "Type" => "Font", "Subtype" => "Type1", "BaseFont" => "Helvetica" });
        let mut resources = dictionary! { "Font" => dictionary! { "F1" => font_id } };
        if let Some(image) = image {
            let image_id = doc.add_object(image);
            resources.set("XObject", dictionary! { "Im1" => image_id });
        }
        let mut content_stream = Stream::new(dictionary! {}, content);
        content_stream.allows_compression = true;
        let content_id = doc.add_object(content_stream);
        let page_id = doc.add_object(dictionary! {
            "Type" => "Page", "Parent" => pages_id, "Contents" => content_id, "Resources" => resources,
            "MediaBox" => vec![0.into(), 0.into(), 595.into(), 842.into()],
        });
        doc.objects.insert(pages_id, Object::Dictionary(dictionary! { "Type" => "Pages", "Kids" => vec![page_id.into()], "Count" => 1 }));
        let catalog_id = doc.add_object(dictionary! { "Type" => "Catalog", "Pages" => pages_id });
        doc.trailer.set("Root", catalog_id);
        let mut bytes = Vec::new();
        doc.save_to(&mut bytes).unwrap();
        bytes
    }

    fn image_sizes(pdf: &[u8]) -> Vec<(i64, i64)> {
        let doc = Document::load_mem(pdf).unwrap();
        doc.objects
            .values()
            .filter_map(|object| match object {
                Object::Stream(stream) if is_image(stream) => Some((
                    stream.dict.get(b"Width").unwrap().as_i64().unwrap(),
                    stream.dict.get(b"Height").unwrap().as_i64().unwrap(),
                )),
                _ => None,
            })
            .collect()
    }

    fn run(input: &[u8], preset: Preset) -> Result<(Vec<u8>, CompressStats), AppError> {
        compress_pdf(input, preset, &AtomicBool::new(false), |_, _| {})
    }

    #[test]
    fn balanced_shrinks_and_downscales_a_large_photo() {
        let input = pdf_with_jpeg(3000, 2000);
        let (output, stats) = run(&input, Preset::Balanced).unwrap();
        assert!(output.len() < input.len(), "{} >= {}", output.len(), input.len());
        assert_eq!(stats, CompressStats { images_found: 1, images_reencoded: 1 });
        assert_eq!(image_sizes(&output), vec![(2500, 1667)]);
        assert_eq!(Document::load_mem(&output).unwrap().get_pages().len(), 1);
    }

    #[test]
    fn small_preset_is_smaller_than_balanced() {
        let input = pdf_with_jpeg(3000, 2000);
        let (balanced, _) = run(&input, Preset::Balanced).unwrap();
        let (small, _) = run(&input, Preset::Small).unwrap();
        assert!(small.len() < balanced.len());
        assert_eq!(image_sizes(&small), vec![(1600, 1067)]);
    }

    #[test]
    fn high_quality_keeps_images_untouched() {
        let input = pdf_with_jpeg(1200, 800);
        let (output, stats) = run(&input, Preset::High).unwrap();
        assert_eq!(stats.images_reencoded, 0);
        assert_eq!(image_sizes(&output), vec![(1200, 800)]);
    }

    #[test]
    fn text_pdf_is_compressed_losslessly_and_keeps_its_text() {
        let input = pdf_with_text();
        let (output, _) = run(&input, Preset::High).unwrap();
        assert!(output.len() < input.len());
        let text = Document::load_mem(&output).unwrap().extract_text(&[1]).unwrap();
        assert!(text.contains("DocCraft keeps documents local. Line 59."));
    }

    #[test]
    fn rejects_non_pdf_input() {
        assert_eq!(run(b"hello", Preset::Balanced).unwrap_err().code, "not-pdf");
        assert_eq!(run(b"%PDF-1.7 garbage", Preset::Balanced).unwrap_err().code, "not-pdf");
    }

    #[test]
    fn rejects_encrypted_input() {
        let mut doc = Document::load_mem(&pdf_with_text()).unwrap();
        let encrypt = doc.add_object(dictionary! { "Filter" => "Standard", "V" => 1, "R" => 2, "P" => -4 });
        doc.trailer.set("Encrypt", encrypt);
        let mut bytes = Vec::new();
        doc.save_to(&mut bytes).unwrap();
        assert_eq!(run(&bytes, Preset::Balanced).unwrap_err().code, "encrypted");
    }

    #[test]
    fn honours_cancellation() {
        let input = pdf_with_jpeg(800, 600);
        let error = compress_pdf(&input, Preset::Balanced, &AtomicBool::new(true), |_, _| {}).unwrap_err();
        assert_eq!(error.code, "cancelled");
    }

    #[test]
    fn reports_image_progress() {
        let input = pdf_with_jpeg(800, 600);
        let mut seen = Vec::new();
        compress_pdf(&input, Preset::Balanced, &AtomicBool::new(false), |current, total| seen.push((current, total))).unwrap();
        assert_eq!(seen, vec![(1, 1)]);
    }

    #[test]
    fn parses_presets() {
        assert_eq!(Preset::parse("high"), Some(Preset::High));
        assert_eq!(Preset::parse("balanced"), Some(Preset::Balanced));
        assert_eq!(Preset::parse("small"), Some(Preset::Small));
        assert_eq!(Preset::parse("max"), None);
    }
}
