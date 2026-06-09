use std::collections::HashMap;
use std::path::Path;

use calamine::{open_workbook, Data, Reader, Xlsx};

use crate::error::{AppError, AppResult};
use crate::models::excel::*;

pub struct ExcelService;

impl ExcelService {
    pub fn get_info(path: &str) -> AppResult<ExcelInfo> {
        let p = Path::new(path);
        let file_name = p
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("unknown")
            .to_string();
        let file_size = std::fs::metadata(path).map(|m| m.len()).unwrap_or(0);

        let mut workbook: Xlsx<_> = open_workbook(path).map_err(|e| {
            AppError::Service(format!("Failed to open workbook: {}", e))
        })?;

        let sheet_names = workbook.sheet_names().to_vec();
        let mut sheets = Vec::new();

        for name in &sheet_names {
            if let Ok(range) = workbook.worksheet_range(name) {
                let mut row_iter = range.rows();
                let first_row = row_iter.next();
                let cols = first_row.map(|r| r.len()).unwrap_or(0);
                let rows = 1 + row_iter.count();
                sheets.push(SheetMeta {
                    name: name.clone(),
                    row_count: rows,
                    column_count: cols,
                });
            }
        }

        Ok(ExcelInfo {
            file_path: path.to_string(),
            file_name,
            file_size,
            sheets,
        })
    }

    pub fn get_column_names(path: &str, sheet: &str) -> AppResult<Vec<ColumnInfo>> {
        let mut workbook: Xlsx<_> = open_workbook(path).map_err(|e| {
            AppError::Service(format!("Failed to open workbook: {}", e))
        })?;

        let range = workbook
            .worksheet_range(sheet)
            .map_err(|e| AppError::Service(format!("Sheet '{}' not found: {}", sheet, e)))?;

        let columns = range
            .rows()
            .next()
            .map(|row| {
                row.iter()
                    .enumerate()
                    .map(|(i, cell)| ColumnInfo {
                        name: cell.to_string(),
                        index: i,
                    })
                    .collect()
            })
            .unwrap_or_default();

        Ok(columns)
    }

    pub fn get_sample_data(path: &str, sheet: &str, rows: usize) -> AppResult<SampleData> {
        let mut workbook: Xlsx<_> = open_workbook(path).map_err(|e| {
            AppError::Service(format!("Failed to open workbook: {}", e))
        })?;

        let range = workbook
            .worksheet_range(sheet)
            .map_err(|e| AppError::Service(format!("Sheet '{}' not found: {}", sheet, e)))?;

        let mut all_rows = range.rows();

        let columns = all_rows
            .next()
            .map(|row| {
                row.iter()
                    .enumerate()
                    .map(|(i, cell)| ColumnInfo {
                        name: cell.to_string(),
                        index: i,
                    })
                    .collect()
            })
            .unwrap_or_default();

        let data_rows: Vec<Vec<Data>> = all_rows.map(|row| row.to_vec()).collect();
        let total_rows = data_rows.len();
        let sample_size = rows.min(total_rows);
        let sample_rows: Vec<Vec<String>> = data_rows
            .iter()
            .take(sample_size)
            .map(|row| row.iter().map(|c| cell_to_string(c)).collect())
            .collect();

        Ok(SampleData {
            columns,
            rows: sample_rows,
            total_rows,
            sample_size,
        })
    }

    pub fn get_column_data(
        path: &str,
        sheet: &str,
        columns: &[String],
    ) -> AppResult<ColumnData> {
        let mut workbook: Xlsx<_> = open_workbook(path).map_err(|e| {
            AppError::Service(format!("Failed to open workbook: {}", e))
        })?;

        let range = workbook
            .worksheet_range(sheet)
            .map_err(|e| AppError::Service(format!("Sheet '{}' not found: {}", sheet, e)))?;

        let mut all_rows = range.rows();

        let header_row: Vec<String> = all_rows
            .next()
            .map(|row| row.iter().map(|c| c.to_string()).collect())
            .unwrap_or_default();

        let column_indices: Vec<usize> = columns
            .iter()
            .filter_map(|col| header_row.iter().position(|h| h == col))
            .collect();

        let data_rows: Vec<Vec<String>> = all_rows
            .map(|row| {
                column_indices
                    .iter()
                    .map(|&i| row.get(i).map(|c| cell_to_string(c)).unwrap_or_default())
                    .collect()
            })
            .collect();

        let total_rows = data_rows.len();

        Ok(ColumnData {
            columns: columns.to_vec(),
            rows: data_rows,
            total_rows,
        })
    }

    pub fn write_results(req: &WriteResultsRequest) -> AppResult<()> {
        use rust_xlsxwriter::*;

        // Read all sheets from the original workbook
        let mut source: Xlsx<_> = open_workbook(&req.path).map_err(|e| {
            map_open_error(e, &req.path)
        })?;

        let sheet_names = source.sheet_names().to_vec();

        let tmp_path = format!("{}.tmp", req.path);
        let mut new_book = Workbook::new();
        let header_format = Format::new().set_bold();

        for name in &sheet_names {
            let range = source
                .worksheet_range(name)
                .map_err(|e| AppError::Service(format!("Sheet '{}' not found: {}", name, e)))?;

            let mut all_rows = range.rows();
            let mut headers: Vec<String> = all_rows
                .next()
                .map(|row| row.iter().map(|c| c.to_string()).collect())
                .unwrap_or_default();

            let mut data_rows: Vec<Vec<String>> = all_rows
                .map(|row| row.iter().map(|c| cell_to_string(c)).collect())
                .collect();

            // Read original formulas for this sheet
            let formula_map: HashMap<(u32, u16), String> = source
                .worksheet_formula(name)
                .ok()
                .map(|fr| {
                    let (sr, sc) = fr.start().unwrap_or((0, 0));
                    fr.cells()
                        .filter(|(_, _, f)| !f.is_empty())
                        .map(|(r, c, f)| ((r as u32 + sr, c as u16 + sc as u16), f.clone()))
                        .collect()
                })
                .unwrap_or_default();

            // If this is the target sheet, add the result column
            if name == &req.sheet {
                let col_idx = match headers.iter().position(|h| h == &req.column) {
                    Some(idx) => idx,
                    None => {
                        headers.push(req.column.clone());
                        headers.len() - 1
                    }
                };

                // Pad rows for new column
                let expected_cols = headers.len();
                for row in &mut data_rows {
                    while row.len() < expected_cols {
                        row.push(String::new());
                    }
                }

                // Write results
                for result in &req.results {
                    let row_idx = result.row;
                    if row_idx < data_rows.len() {
                        // Only write if the cell doesn't already have a formula
                        let excel_row = (row_idx + 1) as u32;
                        if !formula_map.contains_key(&(excel_row, col_idx as u16)) {
                            data_rows[row_idx][col_idx] = result.value.clone();
                        }
                    }
                }
            }

            // Write sheet to new workbook
            let sheet = new_book.add_worksheet();
            sheet.set_name(name)?;

            for (col_i, header) in headers.iter().enumerate() {
                sheet.write_string_with_format(0, col_i as u16, header.as_str(), &header_format)?;
            }

            for (row_i, row) in data_rows.iter().enumerate() {
                for (col_j, value) in row.iter().enumerate() {
                    let excel_row = (row_i + 1) as u32;
                    let pos = (excel_row, col_j as u16);
                    if let Some(orig_f) = formula_map.get(&pos) {
                        let formula = Formula::new(orig_f.as_str());
                        sheet.write_formula(excel_row, col_j as u16, formula)?;
                    } else {
                        sheet.write_string(excel_row, col_j as u16, value.as_str())?;
                    }
                }
            }
        }

        new_book.save(&tmp_path)?;

        std::fs::rename(&tmp_path, &req.path).map_err(|e| {
            if e.kind() == std::io::ErrorKind::PermissionDenied {
                AppError::Service("文件被其他程序（如 Excel）占用，请先关闭文件后重试".into())
            } else {
                AppError::Io(e)
            }
        })?;

        Ok(())
    }

    pub fn apply_formula(req: &ApplyFormulaRequest) -> AppResult<()> {
        use rust_xlsxwriter::*;

        // Read all sheets from the original workbook
        let mut source: Xlsx<_> = open_workbook(&req.path).map_err(|e| {
            map_open_error(e, &req.path)
        })?;

        let sheet_names = source.sheet_names().to_vec();

        let tmp_path = format!("{}.tmp", req.path);
        let mut new_book = Workbook::new();
        let header_format = Format::new().set_bold();

        for name in &sheet_names {
            let range = source
                .worksheet_range(name)
                .map_err(|e| AppError::Service(format!("Sheet '{}' not found: {}", name, e)))?;

            let mut all_rows = range.rows();
            let mut headers: Vec<String> = all_rows
                .next()
                .map(|row| row.iter().map(|c| c.to_string()).collect())
                .unwrap_or_default();

            let data_rows: Vec<Vec<String>> = all_rows
                .map(|row| row.iter().map(|c| cell_to_string(c)).collect())
                .collect();

            // Read original formulas for this sheet
            let formula_map: HashMap<(u32, u16), String> = source
                .worksheet_formula(name)
                .ok()
                .map(|fr| {
                    let (sr, sc) = fr.start().unwrap_or((0, 0));
                    fr.cells()
                        .filter(|(_, _, f)| !f.is_empty())
                        .map(|(r, c, f)| ((r as u32 + sr, c as u16 + sc as u16), f.clone()))
                        .collect()
                })
                .unwrap_or_default();

            // If this is the target sheet, apply the formula column
            if name == &req.sheet {
                let col_idx = match headers.iter().position(|h| h == &req.column) {
                    Some(idx) => idx,
                    None => {
                        if req.strategy == "append" {
                            headers.push(req.column.clone());
                            headers.len() - 1
                        } else {
                            return Err(AppError::Service(format!("Column '{}' not found", req.column)));
                        }
                    }
                };

                let append_mode = req.strategy == "append"
                    && col_idx >= data_rows.first().map_or(0, |r| r.len());

                // Write sheet with formula applied
                let sheet = new_book.add_worksheet();
                sheet.set_name(name)?;

                for (col_i, header) in headers.iter().enumerate() {
                    sheet.write_string_with_format(0, col_i as u16, header.as_str(), &header_format)?;
                }

                for (row_i, row) in data_rows.iter().enumerate() {
                    let col_count = if append_mode { col_idx + 1 } else { row.len() };
                    for col_j in 0..col_count {
                        let excel_row = (row_i + 1) as u32;
                        if col_j == col_idx {
                            let formula_str = req.formula.replace("{}", &(excel_row + 1).to_string());
                            let formula = Formula::new(formula_str.as_str());
                            sheet.write_formula(excel_row, col_j as u16, formula)?;
                        } else {
                            let pos = (excel_row, col_j as u16);
                            if let Some(orig_f) = formula_map.get(&pos) {
                                let formula = Formula::new(orig_f.as_str());
                                sheet.write_formula(excel_row, col_j as u16, formula)?;
                            } else {
                                let value = row.get(col_j).map(|s| s.as_str()).unwrap_or("");
                                sheet.write_string(excel_row, col_j as u16, value)?;
                            }
                        }
                    }
                }
            } else {
                // Non-target sheet: copy as-is
                let sheet = new_book.add_worksheet();
                sheet.set_name(name)?;

                for (col_i, header) in headers.iter().enumerate() {
                    sheet.write_string_with_format(0, col_i as u16, header.as_str(), &header_format)?;
                }

                for (row_i, row) in data_rows.iter().enumerate() {
                    for (col_j, value) in row.iter().enumerate() {
                        let excel_row = (row_i + 1) as u32;
                        let pos = (excel_row, col_j as u16);
                        if let Some(orig_f) = formula_map.get(&pos) {
                            let formula = Formula::new(orig_f.as_str());
                            sheet.write_formula(excel_row, col_j as u16, formula)?;
                        } else {
                            sheet.write_string(excel_row, col_j as u16, value.as_str())?;
                        }
                    }
                }
            }
        }

        new_book.save(&tmp_path)?;

        std::fs::rename(&tmp_path, &req.path).map_err(|e| {
            if e.kind() == std::io::ErrorKind::PermissionDenied {
                AppError::Service("文件被其他程序（如 Excel）占用，请先关闭文件后重试".into())
            } else {
                AppError::Io(e)
            }
        })?;

        Ok(())
    }

    pub fn preview_formula(
        path: &str,
        sheet: &str,
        columns: &[String],
        max_rows: usize,
    ) -> AppResult<FormulaPreviewResult> {
        let mut workbook: Xlsx<_> = open_workbook(path).map_err(|e| {
            AppError::Service(format!("Failed to open workbook: {}", e))
        })?;

        let range = workbook
            .worksheet_range(sheet)
            .map_err(|e| AppError::Service(format!("Sheet '{}' not found: {}", sheet, e)))?;

        let formula_map: HashMap<(u32, u16), String> = workbook
            .worksheet_formula(sheet)
            .ok()
            .map(|fr| {
                let (sr, sc) = fr.start().unwrap_or((0, 0));
                fr.cells()
                    .filter(|(_, _, f)| !f.is_empty())
                    .map(|(r, c, f)| ((r as u32 + sr, c as u16 + sc as u16), f.clone()))
                    .collect()
            })
            .unwrap_or_default();

        let mut all_rows = range.rows();

        let header: Vec<String> = all_rows
            .next()
            .map(|row| row.iter().map(|c| c.to_string()).collect())
            .unwrap_or_default();

        let col_indices: Vec<usize> = columns
            .iter()
            .filter_map(|col| header.iter().position(|h| h == col))
            .collect();

        let data_rows: Vec<Vec<Data>> = all_rows.map(|row| row.to_vec()).collect();
        let total = data_rows.len();
        let count = max_rows.min(total);

        let mut result_rows = Vec::with_capacity(count);
        let mut result_formulas = Vec::with_capacity(count);

        for (ri, row) in data_rows.iter().take(count).enumerate() {
            let excel_row = (ri + 2) as u32;
            let mut vals = Vec::with_capacity(col_indices.len());
            let mut fmuls = Vec::with_capacity(col_indices.len());
            for &ci in &col_indices {
                let cell = row.get(ci).unwrap_or(&Data::Empty);
                vals.push(cell_to_string(cell));
                fmuls.push(formula_map.get(&(excel_row, ci as u16)).cloned());
            }
            result_rows.push(vals);
            result_formulas.push(fmuls);
        }

        Ok(FormulaPreviewResult {
            columns: columns.to_vec(),
            rows: result_rows,
            formulas: result_formulas,
            total_rows: total,
        })
    }

    pub fn get_processing_status(
        path: &str,
        sheet: &str,
        result_column: &str,
    ) -> AppResult<ProcessingStatus> {
        let mut workbook: Xlsx<_> = open_workbook(path).map_err(|e| {
            AppError::Service(format!("Failed to open workbook: {}", e))
        })?;

        let range = workbook
            .worksheet_range(sheet)
            .map_err(|e| AppError::Service(format!("Sheet '{}' not found: {}", sheet, e)))?;

        let mut all_rows = range.rows();

        let header_row: Vec<String> = all_rows
            .next()
            .map(|row| row.iter().map(|c| c.to_string()).collect())
            .unwrap_or_default();

        let result_index = header_row.iter().position(|h| h == result_column);

        let rows: Vec<Vec<String>> = all_rows
            .map(|row| row.iter().map(|c| cell_to_string(c)).collect())
            .collect();

        let total_rows = rows.len();
        let processed_rows: Vec<usize> = match result_index {
            Some(idx) => rows
                .iter()
                .enumerate()
                .filter(|(_, row)| row.get(idx).map(|v| !v.is_empty()).unwrap_or(false))
                .map(|(i, _)| i)
                .collect(),
            None => Vec::new(),
        };

        Ok(ProcessingStatus {
            total_rows,
            processed_rows,
            result_column: result_column.to_string(),
        })
    }
}

fn map_open_error(e: calamine::XlsxError, path: &str) -> AppError {
    if let calamine::XlsxError::Io(io_err) = &e {
        if io_err.kind() == std::io::ErrorKind::PermissionDenied {
            return AppError::Service(
                "文件被其他程序（如 Excel）占用，请先关闭文件后重试".into(),
            );
        }
    }
    AppError::Service(format!("无法打开工作簿「{}」: {}", path, e))
}

fn cell_to_string(cell: &Data) -> String {
    match cell {
        Data::String(s) => s.to_string(),
        Data::Float(f) => f.to_string(),
        Data::Int(i) => i.to_string(),
        Data::Bool(b) => b.to_string(),
        Data::DateTime(d) => d.to_string(),
        Data::DateTimeIso(s) => s.to_string(),
        Data::DurationIso(s) => s.to_string(),
        Data::Error(e) => format!("ERROR: {:?}", e),
        Data::Empty => String::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rust_xlsxwriter::*;
    use std::path::PathBuf;

    fn create_test_xlsx() -> PathBuf {
        let tmp = std::env::temp_dir().join(format!("test-{}.xlsx", std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        let mut workbook = Workbook::new();
        let sheet = workbook.add_worksheet();
        sheet.write_string(0, 0, "Name").unwrap();
        sheet.write_string(0, 1, "Score").unwrap();
        sheet.write_string(1, 0, "Alice").unwrap();
        sheet.write_number(1, 1, 95.0).unwrap();
        sheet.write_string(2, 0, "Bob").unwrap();
        sheet.write_number(2, 1, 87.0).unwrap();
        sheet.write_string(3, 0, "Charlie").unwrap();
        sheet.write_number(3, 1, 92.0).unwrap();
        workbook.save(tmp.to_str().unwrap()).unwrap();
        tmp
    }

    #[test]
    fn test_get_info() {
        let path = create_test_xlsx();
        let info = ExcelService::get_info(path.to_str().unwrap()).unwrap();
        assert_eq!(info.file_name, path.file_name().unwrap().to_str().unwrap());
        assert!(info.file_size > 0);
        assert_eq!(info.sheets.len(), 1);
        assert_eq!(info.sheets[0].name, "Sheet1");
        assert_eq!(info.sheets[0].row_count, 4); // header + 3 rows
        assert_eq!(info.sheets[0].column_count, 2);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn test_get_column_names() {
        let path = create_test_xlsx();
        let cols = ExcelService::get_column_names(path.to_str().unwrap(), "Sheet1").unwrap();
        assert_eq!(cols.len(), 2);
        assert_eq!(cols[0].name, "Name");
        assert_eq!(cols[1].name, "Score");
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn test_get_sample_data() {
        let path = create_test_xlsx();
        let sample = ExcelService::get_sample_data(path.to_str().unwrap(), "Sheet1", 10).unwrap();
        assert_eq!(sample.columns.len(), 2);
        assert_eq!(sample.rows.len(), 3); // 3 data rows
        assert_eq!(sample.total_rows, 3);
        assert_eq!(sample.rows[0][0], "Alice");
        assert_eq!(sample.rows[1][1], "87");
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn test_get_column_data() {
        let path = create_test_xlsx();
        let cols = vec!["Name".into(), "Score".into()];
        let data = ExcelService::get_column_data(path.to_str().unwrap(), "Sheet1", &cols).unwrap();
        assert_eq!(data.columns, cols);
        assert_eq!(data.rows.len(), 3);
        assert_eq!(data.total_rows, 3);
        assert_eq!(data.rows[0][0], "Alice");
        assert_eq!(data.rows[2][1], "92");
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn test_write_results() {
        let path = create_test_xlsx();
        let req = WriteResultsRequest {
            path: path.to_str().unwrap().to_string(),
            sheet: "Sheet1".into(),
            column: "Score".into(),
            results: vec![
                WriteResult { row: 0, value: "100".into() },
                WriteResult { row: 2, value: "98".into() },
            ],
        };
        ExcelService::write_results(&req).unwrap();

        // Verify by re-reading
        let data = ExcelService::get_column_data(path.to_str().unwrap(), "Sheet1", &["Score".into()]).unwrap();
        assert_eq!(data.rows[0][0], "100");
        assert_eq!(data.rows[1][0], "87");
        assert_eq!(data.rows[2][0], "98");
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn test_apply_formula() {
        let path = create_test_xlsx();
        let req = ApplyFormulaRequest {
            path: path.to_str().unwrap().to_string(),
            sheet: "Sheet1".into(),
            column: "Score".into(),
            formula: "=RANK({})".into(),
            strategy: "overwrite".into(),
        };
        ExcelService::apply_formula(&req).unwrap();

        // Verify by re-reading
        let data = ExcelService::get_column_data(path.to_str().unwrap(), "Sheet1", &["Score".into()]).unwrap();
        assert_eq!(data.rows.len(), 3);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn test_apply_formula_append() {
        let path = create_test_xlsx();
        let req = ApplyFormulaRequest {
            path: path.to_str().unwrap().to_string(),
            sheet: "Sheet1".into(),
            column: "Result".into(),
            formula: "=CONCAT(A{}, B{})".into(),
            strategy: "append".into(),
        };
        ExcelService::apply_formula(&req).unwrap();

        // Verify the new column header exists and formula was written
        let cols = ExcelService::get_column_names(path.to_str().unwrap(), "Sheet1").unwrap();
        assert_eq!(cols.len(), 3);
        assert_eq!(cols[2].name, "Result");

        let data = ExcelService::get_column_data(path.to_str().unwrap(), "Sheet1", &["Result".into()]).unwrap();
        assert_eq!(data.rows.len(), 3);
        // Each row should have a non-empty value (the cached "0" from formula)
        assert!(!data.rows[0][0].is_empty());
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn test_apply_formula_preserves_sheet_name() {
        let path = create_test_xlsx();
        // Overwrite the default "Sheet1" sheet name via a different test scenario
        // The existing create_test_xlsx always uses "Sheet1", so we verify the sheet name is preserved
        let req = ApplyFormulaRequest {
            path: path.to_str().unwrap().to_string(),
            sheet: "Sheet1".into(),
            column: "Score".into(),
            formula: "=UPPER(A{})".into(),
            strategy: "overwrite".into(),
        };
        ExcelService::apply_formula(&req).unwrap();

        // Verify the sheet name is still "Sheet1" after round-trip
        let info = ExcelService::get_info(path.to_str().unwrap()).unwrap();
        assert_eq!(info.sheets.len(), 1);
        assert_eq!(info.sheets[0].name, "Sheet1");
        let _ = std::fs::remove_file(&path);
    }

    fn create_test_xlsx_with_formula() -> PathBuf {
        let tmp = std::env::temp_dir().join(format!("test-formula-{}.xlsx", std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        let mut workbook = Workbook::new();
        let sheet = workbook.add_worksheet();
        sheet.set_name("Sheet1").unwrap();
        sheet.write_string(0, 0, "Name").unwrap();
        sheet.write_string(0, 1, "Score").unwrap();
        sheet.write_string(0, 2, "Grade").unwrap();
        sheet.write_string(1, 0, "Alice").unwrap();
        sheet.write_number(1, 1, 95.0).unwrap();
        sheet.write_formula(1, 2, Formula::new("=IF(B2>=90,\"A\",\"B\")")).unwrap();
        sheet.write_string(2, 0, "Bob").unwrap();
        sheet.write_number(2, 1, 87.0).unwrap();
        sheet.write_formula(2, 2, Formula::new("=IF(B3>=90,\"A\",\"B\")")).unwrap();
        sheet.write_string(3, 0, "Charlie").unwrap();
        sheet.write_number(3, 1, 92.0).unwrap();
        sheet.write_formula(3, 2, Formula::new("=IF(B4>=90,\"A\",\"B\")")).unwrap();
        workbook.save(tmp.to_str().unwrap()).unwrap();
        tmp
    }

    #[test]
    fn test_apply_formula_preserves_existing_formulas() {
        let path = create_test_xlsx_with_formula();
        // Apply a formula to the Score column
        let req = ApplyFormulaRequest {
            path: path.to_str().unwrap().to_string(),
            sheet: "Sheet1".into(),
            column: "Score".into(),
            formula: "=RANK({})".into(),
            strategy: "overwrite".into(),
        };
        ExcelService::apply_formula(&req).unwrap();

        // Verify the Grade column still has formulas
        let formula_range = {
            let mut wb: Xlsx<_> = open_workbook(path.to_str().unwrap()).unwrap();
            wb.worksheet_formula("Sheet1").unwrap()
        };
        let (start_row, start_col) = formula_range.start().unwrap_or((0, 0));
        let formulas: Vec<(u32, u16, String)> = formula_range
            .cells()
            .filter(|(_, _, f)| !f.is_empty())
            .map(|(r, c, f)| (r as u32 + start_row, c as u16 + start_col as u16, f.clone()))
            .collect();
        // Should have 6 formulas: 3 original Grade formulas + 3 new Score formulas
        assert_eq!(formulas.len(), 6, "Expected 6 formula cells, got {:?}", formulas);
        // Verify the Grade formulas (col 2) are preserved
        for (r, c, f) in &formulas {
            if *c == 2 {
                assert!(f.contains("IF"), "Expected Grade formula at ({}, {}), got: {}", r, c, f);
            }
            if *c == 1 {
                assert!(f.contains("RANK"), "Expected RANK formula at ({}, {}), got: {}", r, c, f);
            }
        }
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn test_get_processing_status() {
        let path = create_test_xlsx();
        let status = ExcelService::get_processing_status(path.to_str().unwrap(), "Sheet1", "Score").unwrap();
        assert_eq!(status.total_rows, 3);
        // All scores are non-empty
        assert_eq!(status.processed_rows.len(), 3);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn test_get_info_invalid_file() {
        let result = ExcelService::get_info("/nonexistent/file.xlsx");
        assert!(result.is_err());
    }

    #[test]
    fn test_get_column_names_invalid_sheet() {
        let path = create_test_xlsx();
        let result = ExcelService::get_column_names(path.to_str().unwrap(), "InvalidSheet");
        assert!(result.is_err());
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn test_sample_data_limited_rows() {
        let path = create_test_xlsx();
        let sample = ExcelService::get_sample_data(path.to_str().unwrap(), "Sheet1", 1).unwrap();
        assert_eq!(sample.rows.len(), 1);
        assert_eq!(sample.sample_size, 1);
        assert_eq!(sample.total_rows, 3);
        assert_eq!(sample.rows[0][0], "Alice");
        let _ = std::fs::remove_file(&path);
    }

    fn create_multi_sheet_xlsx() -> PathBuf {
        let tmp = std::env::temp_dir().join(format!("test-multi-{}.xlsx", std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        let mut workbook = Workbook::new();
        let sheet1 = workbook.add_worksheet();
        sheet1.set_name("Sheet1").unwrap();
        sheet1.write_string(0, 0, "Name").unwrap();
        sheet1.write_string(1, 0, "Alice").unwrap();
        let sheet2 = workbook.add_worksheet();
        sheet2.set_name("Sheet2").unwrap();
        sheet2.write_string(0, 0, "Product").unwrap();
        sheet2.write_string(1, 0, "Widget").unwrap();
        let sheet3 = workbook.add_worksheet();
        sheet3.set_name("Sheet3").unwrap();
        sheet3.write_string(0, 0, "City").unwrap();
        sheet3.write_string(1, 0, "Beijing").unwrap();
        workbook.save(tmp.to_str().unwrap()).unwrap();
        tmp
    }

    #[test]
    fn test_write_results_preserves_all_sheets() {
        let path = create_multi_sheet_xlsx();

        // Write results to Sheet1
        let req = WriteResultsRequest {
            path: path.to_str().unwrap().to_string(),
            sheet: "Sheet1".into(),
            column: "Result".into(),
            results: vec![
                WriteResult { row: 0, value: "OK".into() },
            ],
        };
        ExcelService::write_results(&req).unwrap();

        // Verify all 3 sheets still exist
        let info = ExcelService::get_info(path.to_str().unwrap()).unwrap();
        assert_eq!(info.sheets.len(), 3);
        assert_eq!(info.sheets[0].name, "Sheet1");
        assert_eq!(info.sheets[1].name, "Sheet2");
        assert_eq!(info.sheets[2].name, "Sheet3");

        // Verify Sheet1 got the new column
        let cols = ExcelService::get_column_names(path.to_str().unwrap(), "Sheet1").unwrap();
        assert_eq!(cols.len(), 2);
        assert_eq!(cols[1].name, "Result");

        // Verify Sheet2 and Sheet3 data is intact
        for sheet_name in &["Sheet2", "Sheet3"] {
            let cols = ExcelService::get_column_names(path.to_str().unwrap(), sheet_name).unwrap();
            assert_eq!(cols.len(), 1, "Sheet {} should have 1 column", sheet_name);
        }
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn test_apply_formula_preserves_all_sheets() {
        let path = create_multi_sheet_xlsx();

        // Apply formula to Sheet1
        let req = ApplyFormulaRequest {
            path: path.to_str().unwrap().to_string(),
            sheet: "Sheet1".into(),
            column: "Result".into(),
            formula: "=UPPER(A{})".into(),
            strategy: "append".into(),
        };
        ExcelService::apply_formula(&req).unwrap();

        // Verify all 3 sheets still exist
        let info = ExcelService::get_info(path.to_str().unwrap()).unwrap();
        assert_eq!(info.sheets.len(), 3);
        assert_eq!(info.sheets[0].name, "Sheet1");
        assert_eq!(info.sheets[1].name, "Sheet2");
        assert_eq!(info.sheets[2].name, "Sheet3");

        // Verify Sheet2 and Sheet3 data is intact
        for sheet_name in &["Sheet2", "Sheet3"] {
            let cols = ExcelService::get_column_names(path.to_str().unwrap(), sheet_name).unwrap();
            assert_eq!(cols.len(), 1, "Sheet {} should have 1 column", sheet_name);
        }
        let _ = std::fs::remove_file(&path);
    }
}
