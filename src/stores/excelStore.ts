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
import type { AgentContext } from '../types/agent';
import { useAgentStore } from './agentStore';

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
  clearAllContext: () => void;
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

    // Only include files that have at least one sheet selected
    const loadedFiles = selections
      .filter((sel) => sel.selectedSheets.length > 0)
      .map((sel) => {
        // For each selected sheet in this file, collect the selected columns
        const sheets = sel.selectedSheets.map((sheetName) => ({
          sheetName,
          columns: sel.selectedColumns[sheetName] || [],
        }));
        return {
          name: sel.file.name,
          path: sel.file.path,
          sheets,
        };
      });

    // Only update context if there's actually loaded content
    if (loadedFiles.length === 0) {
      useAgentStore.getState().setLoadedContext(null);
      return;
    }

    const context: AgentContext = { loadedFiles };

    // Update agentStore with the context (for Agent UI preview)
    useAgentStore.getState().setLoadedContext(context);

    // Send to backend (for Rust/Node.js agent)
    steerAgent(context).catch(() => {});
  },

  clearAllContext: () => {
    // Clear all sheet selections and column selections for every file
    // NOTE: Do NOT clear previewData — it's for the DataPage preview panel,
    // which is unrelated to the Agent context.
    set((state) => ({
      selections: state.selections.map((sel) => ({
        ...sel,
        selectedSheets: [],
        selectedColumns: {},
      })),
    }));
    // Clear UI preview — skip steerAgent() since empty context would trigger
    // an unwanted "上下文已更新" message in the agent conversation.
    // The next notifyContextChange() call (when user loads new context) will
    // re-establish the backpack state.
    useAgentStore.getState().setLoadedContext(null);
  },

  clearError: () => set({ error: null }),
}));
