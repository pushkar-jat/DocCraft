fn main() {
    // Declaring the app's commands makes each one require an explicit capability permission
    // (allow-<command>), instead of being callable by default.
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(&[
        "engine_status",
        "cancel_job",
        "compress_pdf",
        "convert_document",
        "ocr_image",
        "protect_pdf",
        "unlock_pdf",
        "repair_pdf",
        "certificate_info",
        "sign_pdf",
        "scanner_status",
        "scan_page",
    ])))
    .expect("failed to run tauri-build");
}
