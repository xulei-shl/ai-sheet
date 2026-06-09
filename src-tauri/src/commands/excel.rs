use crate::models::excel::*;
use crate::services::excel_service::ExcelService;

#[tauri::command]
pub async fn get_excel_info(path: String) -> Result<ExcelInfo, String> {
    ExcelService::get_info(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_sheet_names(path: String) -> Result<Vec<String>, String> {
    let info = ExcelService::get_info(&path).map_err(|e| e.to_string())?;
    Ok(info.sheets.iter().map(|s| s.name.clone()).collect())
}

#[tauri::command]
pub async fn get_column_names(
    path: String,
    sheet: String,
) -> Result<Vec<ColumnInfo>, String> {
    ExcelService::get_column_names(&path, &sheet).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_sample_data(
    path: String,
    sheet: String,
    rows: Option<usize>,
) -> Result<SampleData, String> {
    ExcelService::get_sample_data(&path, &sheet, rows.unwrap_or(10)).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_column_data(
    path: String,
    sheet: String,
    columns: Vec<String>,
) -> Result<ColumnData, String> {
    ExcelService::get_column_data(&path, &sheet, &columns).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn write_excel_results(req: WriteResultsRequest) -> Result<(), String> {
    ExcelService::write_results(&req).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn apply_excel_formula(req: ApplyFormulaRequest) -> Result<(), String> {
    ExcelService::apply_formula(&req).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn preview_formula(
    path: String,
    sheet: String,
    columns: Vec<String>,
    max_rows: Option<usize>,
) -> Result<FormulaPreviewResult, String> {
    ExcelService::preview_formula(&path, &sheet, &columns, max_rows.unwrap_or(3))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_excel_processing_status(
    path: String,
    sheet: String,
    result_column: String,
) -> Result<ProcessingStatus, String> {
    ExcelService::get_processing_status(&path, &sheet, &result_column)
        .map_err(|e| e.to_string())
}
