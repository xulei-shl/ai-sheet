import { create } from 'zustand';
import type { Prompt, PromptInput } from '../types/prompt';
import {
  getAllPrompts as apiGetAllPrompts,
  savePrompt as apiSavePrompt,
  updatePrompt as apiUpdatePrompt,
  deletePrompt as apiDeletePrompt,
} from '../services/tauri';

interface PromptStore {
  prompts: Prompt[];
  loading: boolean;
  error: string | null;
  searchQuery: string;

  fetchPrompts: () => Promise<void>;
  setSearchQuery: (query: string) => void;
  getFilteredPrompts: () => Prompt[];
  savePrompt: (input: PromptInput) => Promise<void>;
  updatePrompt: (id: string, input: PromptInput) => Promise<void>;
  deletePrompt: (id: string) => Promise<void>;
}

export const usePromptStore = create<PromptStore>((set, get) => ({
  prompts: [],
  loading: false,
  error: null,
  searchQuery: '',

  fetchPrompts: async () => {
    set({ loading: true, error: null });
    try {
      const prompts = await apiGetAllPrompts();
      set({ prompts, loading: false });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e), loading: false });
    }
  },

  setSearchQuery: (query) => set({ searchQuery: query }),

  getFilteredPrompts: () => {
    const { prompts, searchQuery } = get();
    if (!searchQuery.trim()) return prompts;
    const q = searchQuery.toLowerCase();
    return prompts.filter(
      (p) => p.name.toLowerCase().includes(q) || p.content.toLowerCase().includes(q),
    );
  },

  savePrompt: async (input) => {
    try {
      const prompt = await apiSavePrompt(input);
      set({ prompts: [...get().prompts, prompt] });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    }
  },

  updatePrompt: async (id, input) => {
    try {
      await apiUpdatePrompt(id, input);
      const prompts = get().prompts.map((p) =>
        p.id === id
          ? { ...p, name: input.name, content: input.content, category: input.category, updatedAt: new Date().toISOString() }
          : p,
      );
      set({ prompts });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    }
  },

  deletePrompt: async (id) => {
    try {
      await apiDeletePrompt(id);
      set({ prompts: get().prompts.filter((p) => p.id !== id) });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    }
  },
}));
