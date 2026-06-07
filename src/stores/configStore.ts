import { create } from 'zustand';
import type { ModelConfig } from '../types/config';
import {
  getActiveModel,
  getFallbackModels,
  getUserModels,
  addUserModel as apiAddUserModel,
  updateUserModel as apiUpdateUserModel,
  deleteUserModel as apiDeleteUserModel,
} from '../services/tauri';
import { getApiKey, setApiKey, deleteApiKey } from '../services/secureStore';

function secureKeyFor(name: string): string {
  return `api_key:${name}`;
}

async function enrichWithApiKeys(models: ModelConfig[]): Promise<ModelConfig[]> {
  return Promise.all(
    models.map(async (m) => {
      const key = await getApiKey(secureKeyFor(m.name));
      return key ? { ...m, apiKey: key } : m;
    }),
  );
}

interface ConfigStore {
  activeModel: ModelConfig | null;
  fallbackModels: ModelConfig[];
  userModels: ModelConfig[];
  loading: boolean;
  error: string | null;

  fetchModels: () => Promise<void>;
  addModel: (model: ModelConfig) => Promise<void>;
  updateModel: (index: number, model: ModelConfig) => Promise<void>;
  deleteModel: (index: number) => Promise<void>;
  testConnection: (model: ModelConfig) => Promise<string | null>;
  getAllModels: () => ModelConfig[];
  getMergedModels: () => ModelConfig[];
}

export type DisplayModel = ModelConfig & { displaySource: 'user' | 'builtin' };

export function mergeModels(userModels: ModelConfig[], fallbackModels: ModelConfig[]): DisplayModel[] {
  const byName = new Map<string, DisplayModel>();
  for (const m of fallbackModels) {
    byName.set(m.name, { ...m, displaySource: 'builtin' });
  }
  for (const m of userModels) {
    byName.set(m.name, { ...m, displaySource: 'user' });
  }
  return Array.from(byName.values());
}

export const useConfigStore = create<ConfigStore>((set, get) => ({
  activeModel: null,
  fallbackModels: [],
  userModels: [],
  loading: false,
  error: null,

  fetchModels: async () => {
    set({ loading: true, error: null });
    try {
      const [active, fallbacks, rawUserModels] = await Promise.all([
        getActiveModel(),
        getFallbackModels(),
        getUserModels(),
      ]);
      const userModels = await enrichWithApiKeys(rawUserModels);
      set({ activeModel: active, fallbackModels: fallbacks, userModels, loading: false });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e), loading: false });
    }
  },

  addModel: async (model) => {
    try {
      const key = model.apiKey;
      const meta = { ...model, apiKey: '' };
      const created = await apiAddUserModel({ ...meta, source: 'user' });
      if (key) {
        await setApiKey(secureKeyFor(created.name), key);
      }
      set({ userModels: [...get().userModels, { ...created, apiKey: key }] });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    }
  },

  updateModel: async (index, model) => {
    try {
      await apiUpdateUserModel(index, { ...model, apiKey: '', source: 'user' });
      if (model.apiKey) {
        await setApiKey(secureKeyFor(model.name), model.apiKey);
      }
      const userModels = [...get().userModels];
      if (index >= 0 && index < userModels.length) {
        userModels[index] = { ...model, source: 'user' };
        set({ userModels });
      }
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    }
  },

  deleteModel: async (index) => {
    try {
      const target = get().userModels[index];
      await apiDeleteUserModel(index);
      if (target) {
        await deleteApiKey(secureKeyFor(target.name));
      }
      set({ userModels: get().userModels.filter((_, i) => i !== index) });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    }
  },

  testConnection: async (model) => {
    try {
      const response = await fetch(`${model.baseUrl}/models`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${model.apiKey}` },
        signal: AbortSignal.timeout(10000),
      });
      return response.ok ? null : `HTTP ${response.status}: ${response.statusText}`;
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  },

  getAllModels: () => {
    const { fallbackModels, userModels } = get();
    return [...userModels, ...fallbackModels];
  },

  getMergedModels: () => {
    const { fallbackModels, userModels } = get();
    return mergeModels(userModels, fallbackModels);
  },
}));
