export interface ExcelFileInfo {
  path: string;
  name: string;
  size: number;
}

export interface SheetInfo {
  name: string;
  rowCount: number;
  columnCount: number;
}

export interface ColumnInfo {
  name: string;
  sampleValues: string[];
}

export interface PreviewData {
  columns: string[];
  rows: Record<string, string>[];
  totalRows: number;
}

export interface FileSelection {
  file: ExcelFileInfo;
  fileIndex: number;
  sheetInfo: SheetInfo[];
  selectedSheets: string[];
  columnInfo: Record<string, ColumnInfo[]>;
  selectedColumns: Record<string, string[]>;
  previewData: Record<string, PreviewData>;
}

export interface SampleData {
  columns: ColumnInfo[];
  rows: string[][];
  totalRows: number;
  sampleSize: number;
}

export interface ColumnData {
  columns: string[];
  rows: string[][];
  totalRows: number;
}

export interface WriteResult {
  row: number;
  value: string;
}

export interface ApplyFormulaRequest {
  path: string;
  sheet: string;
  column: string;
  formula: string;
}

export interface ProcessingStatus {
  totalRows: number;
  processedRows: number[];
  resultColumn: string;
}
