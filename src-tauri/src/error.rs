use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("Sidecar is not running")]
    SidecarUnavailable,
    #[error("Sidecar command timed out")]
    SidecarTimeout,
    #[error("Sidecar error: {0}")]
    Sidecar(String),
    #[error("Service error: {0}")]
    Service(String),
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("Excel error: {0}")]
    Excel(String),
    #[error("Database error: {0}")]
    Database(String),
}

impl From<rust_xlsxwriter::XlsxError> for AppError {
    fn from(e: rust_xlsxwriter::XlsxError) -> Self {
        match &e {
            rust_xlsxwriter::XlsxError::IoError(io_err)
                if io_err.kind() == std::io::ErrorKind::PermissionDenied =>
            {
                AppError::Service(
                    "文件被其他程序（如 Excel）占用，请先关闭文件后重试".into(),
                )
            }
            _ => AppError::Excel(e.to_string()),
        }
    }
}

impl From<rusqlite::Error> for AppError {
    fn from(e: rusqlite::Error) -> Self {
        AppError::Database(e.to_string())
    }
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;
