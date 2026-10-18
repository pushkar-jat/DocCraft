// Native commands are pure byte transforms: the frontend reads user-selected files through the
// dialog-scoped fs plugin, sends the bytes here, and writes the result itself. Rust never receives
// user file paths, so file access stays limited to what the user picked in native dialogs.

mod appearance;
mod compress;
mod convert;
mod engines;
mod errors;
mod jobs;
mod ocr;
mod process;
mod pdfsign;
mod scan;
mod security;

use std::sync::atomic::AtomicBool;
use std::sync::Arc;

use serde::Serialize;
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{AppHandle, Emitter, Manager, State};

use errors::AppError;
use jobs::Jobs;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProgressEvent {
    job_id: String,
    current: usize,
    total: usize,
}

fn header<'a>(request: &'a Request<'_>, name: &str) -> Result<&'a str, AppError> {
    request
        .headers()
        .get(name)
        .and_then(|value| value.to_str().ok())
        .ok_or_else(|| AppError::bad_request(name))
}

fn raw_body(request: &Request<'_>) -> Result<Vec<u8>, AppError> {
    match request.body() {
        InvokeBody::Raw(bytes) => Ok(bytes.clone()),
        InvokeBody::Json(_) => Err(AppError::bad_request("body")),
    }
}

/// Decodes a percent-encoded header value (the frontend uses encodeURIComponent so that
/// non-ASCII passwords survive HTTP header rules).
fn decoded_header(request: &Request<'_>, name: &str) -> Result<String, AppError> {
    let raw = header(request, name)?;
    let mut bytes = Vec::with_capacity(raw.len());
    let mut iter = raw.bytes();
    while let Some(byte) = iter.next() {
        if byte == b'%' {
            let hex = [iter.next(), iter.next()];
            let [Some(h), Some(l)] = hex else { return Err(AppError::bad_request(name)) };
            let value = u8::from_str_radix(std::str::from_utf8(&[h, l]).map_err(|_| AppError::bad_request(name))?, 16).map_err(|_| AppError::bad_request(name))?;
            bytes.push(value);
        } else {
            bytes.push(byte);
        }
    }
    String::from_utf8(bytes).map_err(|_| AppError::bad_request(name))
}

/// Runs blocking work off the async runtime with a registered cancellation flag.
async fn run_job<T: Send + 'static>(
    jobs: &Jobs,
    job_id: &str,
    work: impl FnOnce(Arc<AtomicBool>) -> Result<T, AppError> + Send + 'static,
) -> Result<T, AppError> {
    let cancel = jobs.register(job_id);
    let result = tauri::async_runtime::spawn_blocking(move || work(cancel)).await;
    jobs.finish(job_id);
    result.map_err(|_| AppError::internal())?
}

#[tauri::command]
async fn engine_status() -> Result<engines::EngineStatus, AppError> {
    tauri::async_runtime::spawn_blocking(engines::status).await.map_err(|_| AppError::internal())
}

#[tauri::command]
fn cancel_job(jobs: State<'_, Jobs>, job_id: String) -> bool {
    jobs.cancel(&job_id)
}

#[tauri::command]
async fn compress_pdf(app: AppHandle, jobs: State<'_, Jobs>, request: Request<'_>) -> Result<Response, AppError> {
    let job_id = header(&request, "x-job-id")?.to_owned();
    let preset = compress::Preset::parse(header(&request, "x-preset")?).ok_or_else(|| AppError::bad_request("preset"))?;
    let input = raw_body(&request)?;
    let event_job_id = job_id.clone();
    let (bytes, _stats) = run_job(&jobs, &job_id, move |cancel| {
        compress::compress_pdf(&input, preset, &cancel, |current, total| {
            let _ = app.emit("job-progress", ProgressEvent { job_id: event_job_id.clone(), current, total });
        })
    })
    .await?;
    Ok(Response::new(bytes))
}

#[tauri::command]
async fn convert_document(app: AppHandle, jobs: State<'_, Jobs>, request: Request<'_>) -> Result<Response, AppError> {
    let job_id = header(&request, "x-job-id")?.to_owned();
    let extension = header(&request, "x-extension")?.to_ascii_lowercase();
    let conversion = convert::Conversion::parse(header(&request, "x-conversion")?).ok_or_else(|| AppError::bad_request("conversion"))?;
    let input = raw_body(&request)?;
    let soffice = engines::find_soffice().ok_or_else(|| {
        AppError::new("engine-missing", "LibreOffice was not found. Install LibreOffice, then try again.")
    })?;
    let profile = app.path().app_local_data_dir().map_err(|_| AppError::internal())?.join("libreoffice-profile");
    let bytes = run_job(&jobs, &job_id, move |cancel| {
        convert::convert(&soffice, &profile, &input, &extension, conversion, &cancel, convert::CONVERSION_TIMEOUT)
    })
    .await?;
    Ok(Response::new(bytes))
}

#[tauri::command]
async fn ocr_image(jobs: State<'_, Jobs>, request: Request<'_>) -> Result<Response, AppError> {
    let job_id = header(&request, "x-job-id")?.to_owned();
    let languages: Vec<String> = header(&request, "x-languages")?.split('+').map(str::to_owned).collect();
    let dpi = request.headers().get("x-dpi").and_then(|value| value.to_str().ok()?.parse().ok());
    let image = raw_body(&request)?;
    let tesseract = engines::find_tesseract().ok_or_else(|| {
        AppError::new("engine-missing", "Tesseract OCR was not found. Install Tesseract, then try again.")
    })?;
    let bytes = run_job(&jobs, &job_id, move |cancel| {
        ocr::ocr_image_to_pdf(&tesseract, &image, &languages, dpi, &cancel, ocr::OCR_TIMEOUT)
    })
    .await?;
    Ok(Response::new(bytes))
}

#[tauri::command]
async fn protect_pdf(jobs: State<'_, Jobs>, request: Request<'_>) -> Result<Response, AppError> {
    let job_id = header(&request, "x-job-id")?.to_owned();
    let user = decoded_header(&request, "x-user-password")?;
    let owner = decoded_header(&request, "x-owner-password")?;
    let allow = header(&request, "x-allow")?;
    let allowed = security::Allowed { printing: allow.contains("print"), copying: allow.contains("copy"), editing: allow.contains("edit") };
    let input = raw_body(&request)?;
    let bytes = run_job(&jobs, &job_id, move |_| security::protect(&input, &user, &owner, allowed)).await?;
    Ok(Response::new(bytes))
}

#[tauri::command]
async fn unlock_pdf(jobs: State<'_, Jobs>, request: Request<'_>) -> Result<Response, AppError> {
    let job_id = header(&request, "x-job-id")?.to_owned();
    let password = decoded_header(&request, "x-password")?;
    let input = raw_body(&request)?;
    let bytes = run_job(&jobs, &job_id, move |_| security::unlock(&input, &password)).await?;
    Ok(Response::new(bytes))
}

#[tauri::command]
async fn repair_pdf(jobs: State<'_, Jobs>, request: Request<'_>) -> Result<Response, AppError> {
    let job_id = header(&request, "x-job-id")?.to_owned();
    let input = raw_body(&request)?;
    let (bytes, _pages) = run_job(&jobs, &job_id, move |_| security::repair(&input)).await?;
    Ok(Response::new(bytes))
}

#[tauri::command]
async fn certificate_info(jobs: State<'_, Jobs>, request: Request<'_>) -> Result<pdfsign::CertificateInfo, AppError> {
    let job_id = header(&request, "x-job-id")?.to_owned();
    let password = decoded_header(&request, "x-p12-password")?;
    let p12 = raw_body(&request)?;
    run_job(&jobs, &job_id, move |_| pdfsign::certificate_info(&p12, &password)).await
}

/// Body: 4-byte big-endian PDF length, the PDF, then the PKCS#12 certificate file.
#[tauri::command]
async fn sign_pdf(jobs: State<'_, Jobs>, request: Request<'_>) -> Result<Response, AppError> {
    let job_id = header(&request, "x-job-id")?.to_owned();
    let password = decoded_header(&request, "x-p12-password")?;
    let page: usize = header(&request, "x-page")?.parse().map_err(|_| AppError::bad_request("page"))?;
    let rect_text = header(&request, "x-rect")?;
    let rect = if rect_text.is_empty() {
        None
    } else {
        let values: Vec<f64> = rect_text.split(',').filter_map(|v| v.trim().parse().ok()).collect();
        let [x1, y1, x2, y2] = values[..] else { return Err(AppError::bad_request("rect")) };
        Some([x1, y1, x2, y2])
    };
    let options = pdfsign::SignOptions { page, rect, reason: decoded_header(&request, "x-reason")?, location: decoded_header(&request, "x-location")? };
    let body = raw_body(&request)?;
    if body.len() < 4 {
        return Err(AppError::bad_request("body"));
    }
    let pdf_len = u32::from_be_bytes([body[0], body[1], body[2], body[3]]) as usize;
    if body.len() < 4 + pdf_len {
        return Err(AppError::bad_request("body"));
    }
    let bytes = run_job(&jobs, &job_id, move |_| {
        let (pdf, p12) = body[4..].split_at(pdf_len);
        pdfsign::sign_pdf(pdf, p12, &password, &options)
    })
    .await?;
    Ok(Response::new(bytes))
}

#[tauri::command]
async fn scanner_status() -> Result<scan::ScannerStatus, AppError> {
    tauri::async_runtime::spawn_blocking(scan::scanner_status).await.map_err(|_| AppError::internal())
}

#[tauri::command]
async fn scan_page(jobs: State<'_, Jobs>, job_id: String) -> Result<Response, AppError> {
    let bytes = run_job(&jobs, &job_id, move |cancel| scan::scan_page(&cancel)).await?;
    Ok(Response::new(bytes))
}

#[tauri::command]
async fn window_appearance(mica: State<'_, MicaEnabled>) -> Result<appearance::WindowAppearance, AppError> {
    let accent = tauri::async_runtime::spawn_blocking(appearance::accent_palette).await.map_err(|_| AppError::internal())?;
    Ok(appearance::WindowAppearance { mica: mica.0, accent })
}

/// Whether the main window was created with the Mica backdrop.
struct MicaEnabled(bool);

/// Creates the main window from its config. On Windows 11 it gets the Mica backdrop, which
/// needs a transparent window; elsewhere it stays opaque so nothing behind it shows through.
fn create_main_window(app: &tauri::App) -> tauri::Result<bool> {
    let config = app.config().app.windows.iter().find(|w| w.label == "main").cloned().ok_or(tauri::Error::WindowNotFound)?;
    let mica = appearance::supports_mica();
    let mut builder = tauri::WebviewWindowBuilder::from_config(app, &config)?;
    if mica {
        builder = builder
            .transparent(true)
            .effects(tauri::utils::config::WindowEffectsConfig { effects: vec![tauri::window::Effect::Mica], ..Default::default() });
    }
    builder.build()?;
    Ok(mica)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(Jobs::default())
        .setup(|app| {
            let mica = create_main_window(app)?;
            app.manage(MicaEnabled(mica));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![engine_status, cancel_job, compress_pdf, convert_document, ocr_image, protect_pdf, unlock_pdf, repair_pdf, certificate_info, sign_pdf, scanner_status, scan_page, window_appearance])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
