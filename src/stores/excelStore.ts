import { create } from 'zustand';
import {
  getExcelInfo,
  getSheetNames,
  getColumnNames,
  getSampleData,
  getColumnData,
  writeExcelResults,
  applyExcelFormula,
  getExcelProcessingStatus,
  steerAgent,
} from '../services/tauri';
import type {
  ExcelFileInfo,
  FileSelection,
  PreviewData,
  SheetInfo,
  WriteResult,
  ApplyFormulaRequest,
} from '../types/excel';

interface ExcelStore {
  files: ExcelFileInfo[];
  selections: FileSelection[];
  previewData: PreviewData | null;
  loading: boolean;
  error: string | null;

  addFile: (path: string) => Promise<void>;
  removeFile: (index: number) => void;
  selectSheets: (fileIndex: number, sheets: string[]) => Promise<void>;
  selectColumns: (fileIndex: number, sheet: string, columns: string[]) => Promise<void>;
  loadPreview: (fileIndex: number, sheet: string) => Promise<void>;
  applyFormula: (req: ApplyFormulaRequest) => Promise<void>;
  writeResults: (path: string, sheet: string, column: string, results: WriteResult[]) => Promise<void>;
  notifyContextChange: () => void;
  clearError: () => void;
}

export const useExcelStore = create<ExcelStore>((set, get) => ({
  files: [],
  selections: [],
  previewData: null,
  loading: false,
  error: null,

  addFile: async (path: string) => {
    set({ loading: true, error: null });
    try {
      const info = await getExcelInfo(path);
      const fileInfo: ExcelFileInfo = {
        path: info.filePath,
        name: info.fileName,
        size: info.fileSize,
      };
      const sheetInfos: SheetInfo[] = info.sheets.map((s) => ({
        name: s.name,
        rowCount: s.rowCount,
        columnCount: s.columnCount,
      }));
      const selection: FileSelection = {
        file: fileInfo,
        fileIndex: get().files.length,
        sheetInfo: sheetInfos,
        selectedSheets: [],
        columnInfo: {},
        selectedColumns: {},
        previewData: {},
      };
      set((state) => ({
        files: [...state.files, fileInfo],
        selections: [...state.selections, selection],
        loading: false,
      }));
    } catch (e) {
      set({ loading: false, error: e instanceof Error ? e.message : String(e) });
    }
  },

  removeFile: (index: number) => {
    set((state) => ({
      files: state.files.filter((_, i) => i !== index),
      selections: state.selections.filter((_, i) => i !== index),
      previewData: null,
    }));
  },

  selectSheets: async (fileIndex: number, sheets: string[]) => {
    set((state) => {
      const selections = [...state.selections];
      const sel = { ...selections[fileIndex] };
      sel.selectedSheets = sheets;

      getColumnNames(sel.file.path, sheets[0]).then((cols) => {
        set((s) => {
          const updated = [...s.selections];
          updated[fileIndex] = {
            ...updated[fileIndex],
            columnInfo: { ...updated[fileIndex].columnInfo, [sheets[0]]: cols },
            selectedColumns: { ...updated[fileIndex].selectedColumns, [sheets[0]]: [] },
          };
          return { selections: updated };
        });
      });

      selections[fileIndex] = sel;
      return { selections };
    });
  },

  selectColumns: async (fileIndex: number, sheet: string, columns: string[]) => {
    set((state) => {
      const sels = [...state.selections];
      const sel = { ...sels[fileIndex] };
      sel.selectedColumns = { ...sel.selectedColumns, [sheet]: columns };
      sels[fileIndex] = sel;
      return { selections: sels };
    });
  },

  loadPreview: async (fileIndex: number, sheet: string) => {
    const { selections } = get();
    const sel = selections[fileIndex];
    if (!sel) return;

    set({ loading: true, error: null });
    try {
      const data = await getSampleData(sel.file.path, sheet, 10);
      const previewData: PreviewData = {
        columns: data.columns.map((c) => c.name),
        rows: data.rows.map((row) => {
          const record: Record<string, string> = {};
          data.columns.forEach((col, i) => {
            record[col.name] = row[i] ?? '';
          });
          return record;
        }),
        totalRows: data.totalRows,
      };
      set((state) => {
        const selections = [...state.selections];
        selections[fileIndex] = {
          ...selections[fileIndex],
          previewData: { ...selections[fileIndex].previewData, [sheet]: previewData },
        };
        return { selections, previewData, loading: false };
      });
    } catch (e) {
      set({ loading: false, error: e instanceof Error ? e.message : String(e) });
    }
  },

  applyFormula: async (req: ApplyFormulaRequest) => {
    set({ loading: true, error: null });
    try {
      await applyExcelFormula({
        path: req.path,
        sheet: req.sheet,
        column: req.column,
        formula: req.formula,
      });
      set({ loading: false });
    } catch (e) {
      set({ loading: false, error: e instanceof Error ? e.message : String(e) });
    }
  },

  writeResults: async (path: string, sheet: string, column: string, results: WriteResult[]) => {
    set({ loading: true, error: null });
    try {
      await writeExcelResults({ path, sheet, column, results });
      set({ loading: false });
    } catch (e) {
      set({ loading: false, error: e instanceof Error ? e.message : String(e) });
    }
  },

  notifyContextChange: () => {
    const { files, selections } = get();
    const loadedFiles = files.map((f) => f.path);
    const selectedCols = selections.flatMap((s) =>
      Object.values(s.selectedColumns).flat()
    );
    steerAgent({
      currentTab: 'data',
      loadedFiles,
      selectedColumns: selectedCols,
    }).catch(() => {});
  },

  clearError: () => set({ error: null }),
}));
