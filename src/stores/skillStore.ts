import { create } from 'zustand';
import type { SkillInfo, SkillDetail, SkillInput, FileNode } from '../types/skill';
import {
  listSkills as apiListSkills,
  readSkill as apiReadSkill,
  readSkillFile as apiReadSkillFile,
  listSkillFiles as apiListSkillFiles,
  createSkill as apiCreateSkill,
  deleteSkill as apiDeleteSkill,
  updateSkillFile as apiUpdateSkillFile,
  deleteSkillFile as apiDeleteSkillFile,
  createSkillFile as apiCreateSkillFile,
  importSkillFromFolder as apiImportSkillFromFolder,
} from '../services/tauri';

interface SkillStore {
  skills: SkillInfo[];
  detail: SkillDetail | null;
  fileTree: FileNode[];
  selectedFile: string | null;
  selectedFileContent: string | null;
  loading: boolean;
  error: string | null;
  searchQuery: string;

  fetchSkills: (projectRoot: string) => Promise<void>;
  selectSkill: (projectRoot: string, name: string) => Promise<void>;
  selectFile: (projectRoot: string, skillName: string, filePath: string | null) => Promise<void>;
  createSkill: (projectRoot: string, input: SkillInput) => Promise<void>;
  deleteSkill: (projectRoot: string, name: string) => Promise<void>;
  updateSkillFile: (projectRoot: string, skillName: string, filePath: string, content: string) => Promise<void>;
  deleteSkillFile: (projectRoot: string, skillName: string, filePath: string) => Promise<void>;
  createSkillFile: (projectRoot: string, skillName: string, filePath: string, content: string) => Promise<void>;
  importSkillFromFolder: (projectRoot: string, sourcePath: string, skillName?: string) => Promise<SkillInfo | null>;
  refreshFileTree: (projectRoot: string, skillName: string) => Promise<void>;
  setSearchQuery: (query: string) => void;
  getFilteredSkills: () => SkillInfo[];
  clearSelection: () => void;
}

export const useSkillStore = create<SkillStore>((set, get) => ({
  skills: [],
  detail: null,
  fileTree: [],
  selectedFile: null,
  selectedFileContent: null,
  loading: false,
  error: null,
  searchQuery: '',

  fetchSkills: async (projectRoot: string) => {
    set({ loading: true, error: null });
    try {
      const skills = await apiListSkills(projectRoot);
      set({ skills, loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  selectSkill: async (projectRoot: string, name: string) => {
    set({ loading: true, error: null });
    try {
      const [detail, fileTree] = await Promise.all([
        apiReadSkill(projectRoot, name),
        apiListSkillFiles(projectRoot, name),
      ]);
      set({ detail, fileTree, selectedFile: null, selectedFileContent: null, loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  selectFile: async (projectRoot: string, skillName: string, filePath: string | null) => {
    if (!filePath) {
      set({ selectedFile: null, selectedFileContent: null });
      return;
    }
    try {
      const content = await apiReadSkillFile(projectRoot, skillName, filePath);
      set({ selectedFile: filePath, selectedFileContent: content });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  createSkill: async (projectRoot: string, input: SkillInput) => {
    try {
      const skill = await apiCreateSkill(projectRoot, input);
      set({ skills: [...get().skills, skill] });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  deleteSkill: async (projectRoot: string, name: string) => {
    try {
      await apiDeleteSkill(projectRoot, name);
      const skills = get().skills.filter((s) => s.name !== name);
      const detail = get().detail?.name === name ? null : get().detail;
      set({ skills, detail, fileTree: detail ? get().fileTree : [], selectedFile: null, selectedFileContent: null });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  updateSkillFile: async (projectRoot: string, skillName: string, filePath: string, content: string) => {
    try {
      await apiUpdateSkillFile(projectRoot, skillName, filePath, content);
      // Update local content if this is the currently selected file
      if (get().selectedFile === filePath) {
        set({ selectedFileContent: content });
      }
      // If SKILL.md was updated, also refresh detail
      if (filePath === 'SKILL.md') {
        const detail = await apiReadSkill(projectRoot, skillName);
        set({ detail });
        // Also update skill info in the list
        const skills = get().skills.map((s) =>
          s.name === skillName ? { ...s, name: detail.name, description: detail.description } : s
        );
        set({ skills });
      }
    } catch (e) {
      set({ error: String(e) });
    }
  },

  deleteSkillFile: async (projectRoot: string, skillName: string, filePath: string) => {
    try {
      await apiDeleteSkillFile(projectRoot, skillName, filePath);
      // If the deleted file was selected, clear selection
      if (get().selectedFile === filePath) {
        set({ selectedFile: null, selectedFileContent: null });
      }
      // Refresh file tree
      const fileTree = await apiListSkillFiles(projectRoot, skillName);
      set({ fileTree });
      // If SKILL.md was deleted, refresh detail too
      if (filePath === 'SKILL.md') {
        const detail = get().detail;
        if (detail && detail.name === skillName) {
          set({ detail: { ...detail, content: '', raw: '', description: '' } });
        }
      }
    } catch (e) {
      set({ error: String(e) });
    }
  },

  createSkillFile: async (projectRoot: string, skillName: string, filePath: string, content: string) => {
    try {
      await apiCreateSkillFile(projectRoot, skillName, filePath, content);
      // Refresh file tree
      const fileTree = await apiListSkillFiles(projectRoot, skillName);
      set({ fileTree });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  importSkillFromFolder: async (projectRoot: string, sourcePath: string, skillName?: string) => {
    try {
      const skill = await apiImportSkillFromFolder(projectRoot, sourcePath, skillName);
      set({ skills: [...get().skills, skill] });
      return skill;
    } catch (e) {
      set({ error: String(e) });
      return null;
    }
  },

  refreshFileTree: async (projectRoot: string, skillName: string) => {
    try {
      const fileTree = await apiListSkillFiles(projectRoot, skillName);
      set({ fileTree });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  setSearchQuery: (query) => set({ searchQuery: query }),

  getFilteredSkills: () => {
    const { skills, searchQuery } = get();
    if (!searchQuery.trim()) return skills;
    const q = searchQuery.toLowerCase();
    return skills.filter(
      (s) => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q),
    );
  },

  clearSelection: () => set({ detail: null, fileTree: [], selectedFile: null, selectedFileContent: null }),
}));
