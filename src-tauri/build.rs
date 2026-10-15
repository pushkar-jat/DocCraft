fn main() {
    // Declaring the app's commands makes each one require an explicit capability permission
    // (allow-<command>), instead of being callable by default.
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(&[
        "engine_status",
        "cancel_job",
        "compress_pdf",
        "convert_word_to_pdf",
        "ocr_image",
    ])))
    .expect("failed to run tauri-build");
}
