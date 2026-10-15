// DocCraft has no custom Rust commands in Phase 1. PDF merging runs locally in the
// webview (pdf-lib); file access goes through the dialog and fs plugins, whose
// permissions are limited in `capabilities/default.json`.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
