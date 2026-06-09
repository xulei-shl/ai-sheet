export interface FormulaCacheEntry {
  id: number;
  requirement: string;
  columnsKey: string;
  formula: string;
  explanation: string;
  accessedAt: string;
  createdAt: string;
}

export interface PinnedFormula {
  id: number;
  name: string;
  formula: string;
  columnsKey: string;
  createdAt: string;
}
