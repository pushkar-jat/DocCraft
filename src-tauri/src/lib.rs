// Native commands are pure byte transforms: the frontend reads user-selected files through the
// dialog-scoped fs plugin, sends the bytes here, and writes the result itself. Rust never receives
// user file paths, so file access stays limited to what the user picked in native dialogs.

mod compress;
mod convert;
mod engines;
mod errors;
mod jobs;
mod ocr;
mod process;

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
async fn convert_word_to_pdf(app: AppHandle, jobs: State<'_, Jobs>, request: Request<'_>) -> Result<Response, AppError> {
    let job_id = header(&request, "x-job-id")?.to_owned();
    let extension = header(&request, "x-extension")?.to_ascii_lowercase();
    let input = raw_body(&request)?;
    let soffice = engines::find_soffice().ok_or_else(|| {
        AppError::new("engine-missing", "LibreOffice was not found. Install LibreOffice, then try again.")
    })?;
    let profile = app.path().app_local_data_dir().map_err(|_| AppError::internal())?.join("libreoffice-profile");
    let bytes = run_job(&jobs, &job_id, move |cancel| {
        convert::word_to_pdf(&soffice, &profile, &input, &extension, &cancel, convert::CONVERSION_TIMEOUT)
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(Jobs::default())
        .invoke_handler(tauri::generate_handler![engine_status, cancel_job, compress_pdf, convert_word_to_pdf, ocr_image])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
