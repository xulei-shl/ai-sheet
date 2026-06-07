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

        let mut workbook: Xlsx<_> = open_workbook(&req.path)
            .map_err(|e| AppError::Service(format!("Failed to open workbook: {}", e)))?;

        let range = workbook
            .worksheet_range(&req.sheet)
            .map_err(|e| AppError::Service(format!("Sheet '{}' not found: {}", req.sheet, e)))?;

        let mut all_rows = range.rows();

        let headers: Vec<String> = all_rows
            .next()
            .map(|row| row.iter().map(|c| c.to_string()).collect())
            .unwrap_or_default();

        let col_idx = headers
            .iter()
            .position(|h| h == &req.column)
            .ok_or_else(|| AppError::Service(format!("Column '{}' not found", req.column)))?;

        let data_rows: Vec<Vec<String>> = all_rows
            .map(|row| row.iter().map(|c| cell_to_string(c)).collect())
            .collect();

        let tmp_path = format!("{}.tmp", req.path);
        let mut new_book = Workbook::new();
        let sheet = new_book.add_worksheet();

        let header_format = Format::new().set_bold();

        for (col_i, header) in headers.iter().enumerate() {
            sheet.write_string_with_format(0, col_i as u16, header.as_str(), &header_format)?;
        }

        for (row_i, row) in data_rows.iter().enumerate() {
            for (col_j, value) in row.iter().enumerate() {
                sheet.write_string((row_i + 1) as u32, col_j as u16, value.as_str())?;
            }
        }

        for result in &req.results {
            let excel_row = result.row as u32 + 1;
            sheet.write_string(excel_row, col_idx as u16, result.value.as_str())?;
        }

        new_book.save(&tmp_path)?;

        std::fs::rename(&tmp_path, &req.path)?;

        Ok(())
    }

    pub fn apply_formula(req: &ApplyFormulaRequest) -> AppResult<()> {
        use rust_xlsxwriter::*;

        let mut workbook: Xlsx<_> = open_workbook(&req.path)
            .map_err(|e| AppError::Service(format!("Failed to open workbook: {}", e)))?;

        let range = workbook
            .worksheet_range(&req.sheet)
            .map_err(|e| AppError::Service(format!("Sheet '{}' not found: {}", req.sheet, e)))?;

        let mut all_rows = range.rows();

        let headers: Vec<String> = all_rows
            .next()
            .map(|row| row.iter().map(|c| c.to_string()).collect())
            .unwrap_or_default();

        let col_idx = headers
            .iter()
            .position(|h| h == &req.column)
            .ok_or_else(|| AppError::Service(format!("Column '{}' not found", req.column)))?;

        let data_rows: Vec<Vec<String>> = all_rows
            .map(|row| row.iter().map(|c| cell_to_string(c)).collect())
            .collect();

        let tmp_path = format!("{}.tmp", req.path);
        let mut new_book = Workbook::new();
        let sheet = new_book.add_worksheet();

        let header_format = Format::new().set_bold();

        for (col_i, header) in headers.iter().enumerate() {
            sheet.write_string_with_format(0, col_i as u16, header.as_str(), &header_format)?;
        }

        for (row_i, row) in data_rows.iter().enumerate() {
            for (col_j, value) in row.iter().enumerate() {
                if col_j == col_idx {
                    let excel_row = (row_i + 1) as u32;
                    let formula_str = req.formula.replace("{}", &(excel_row + 1).to_string());
                    let formula = Formula::new(formula_str.as_str());
                    sheet.write_formula(excel_row, col_j as u16, formula)?;
                } else {
                    sheet.write_string((row_i + 1) as u32, col_j as u16, value.as_str())?;
                }
            }
        }

        new_book.save(&tmp_path)?;

        std::fs::rename(&tmp_path, &req.path)?;

        Ok(())
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
        };
        ExcelService::apply_formula(&req).unwrap();

        // Verify by re-reading
        let data = ExcelService::get_column_data(path.to_str().unwrap(), "Sheet1", &["Score".into()]).unwrap();
        assert_eq!(data.rows.len(), 3);
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
}
