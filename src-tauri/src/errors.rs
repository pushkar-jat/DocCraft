use serde::Serialize;

/// An expected, user-explainable failure. Serialised to the frontend as `{ code, message }`.
/// Messages never contain document contents or full file paths.
#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct AppError {
    pub code: &'static str,
    pub message: String,
}

impl AppError {
    pub fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self { code, message: message.into() }
    }

    pub fn cancelled() -> Self {
        Self::new("cancelled", "The operation was cancelled. No output file was written.")
    }

    pub fn internal() -> Self {
        Self::new("internal", "Something unexpected went wrong. No output file was written.")
    }

    pub fn bad_request(detail: &str) -> Self {
        Self::new("internal", format!("Invalid request from the interface ({detail})."))
    }
}

impl From<std::io::Error> for AppError {
    fn from(_: std::io::Error) -> Self {
        Self::new("internal", "A temporary file could not be created or read.")
    }
}
