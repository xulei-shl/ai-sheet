import { create } from 'zustand';
import type { ModelConfig } from '../types/config';
import {
  getActiveModel,
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

let fetchVersion = 0;

interface ConfigStore {
  activeModel: ModelConfig | null;
  userModels: ModelConfig[];
  loading: boolean;
  error: string | null;

  fetchModels: () => Promise<void>;
  addModel: (model: ModelConfig) => Promise<void>;
  updateModel: (index: number, model: ModelConfig) => Promise<void>;
  deleteModel: (index: number) => Promise<void>;
  testConnection: (model: ModelConfig) => Promise<string | null>;
  getAllModels: () => ModelConfig[];
  /** Alias: returns user models enriched with API keys from secure store */
  getMergedModels: () => ModelConfig[];
}

export const useConfigStore = create<ConfigStore>((set, get) => ({
  activeModel: null,
  userModels: [],
  loading: false,
  error: null,

  fetchModels: async () => {
    const version = ++fetchVersion;
    set({ loading: true, error: null });
    try {
      const [active, rawUserModels] = await Promise.all([
        getActiveModel(),
        getUserModels(),
      ]);
      if (version !== fetchVersion) return;
      const userModels = await enrichWithApiKeys(rawUserModels);
      if (version !== fetchVersion) return;
      set({ activeModel: active, userModels, loading: false });
    } catch (e) {
      if (version === fetchVersion) {
        set({ error: e instanceof Error ? e.message : String(e), loading: false });
      }
    }
  },

  addModel: async (model) => {
    fetchVersion++;
    try {
      const key = model.apiKey;
      const meta = { ...model, apiKey: '' };
      const created = await apiAddUserModel(meta);
      if (key) {
        await setApiKey(secureKeyFor(created.name), key);
      }
      set({ userModels: [...get().userModels, { ...created, apiKey: key }] });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    }
  },

  updateModel: async (index, model) => {
    fetchVersion++;
    try {
      await apiUpdateUserModel(index, { ...model, apiKey: '' });
      if (model.apiKey) {
        await setApiKey(secureKeyFor(model.name), model.apiKey);
      }
      const userModels = [...get().userModels];
      if (index >= 0 && index < userModels.length) {
        userModels[index] = model;
        set({ userModels });
      }
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    }
  },

  deleteModel: async (index) => {
    fetchVersion++;
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
    return get().userModels;
  },

  getMergedModels: () => {
    return get().userModels;
  },
}));
