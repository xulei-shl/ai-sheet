import { create } from 'zustand';

export type AppTab = 'data' | 'formula' | 'ai' | 'config' | 'prompts' | 'skills';

export type ThemeMode = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

export const SIDEBAR_LEFT_MIN = 48;
export const SIDEBAR_LEFT_MAX = 400;
export const SIDEBAR_LEFT_DEFAULT = 192;

export const SIDEBAR_RIGHT_MIN = 200;
export const SIDEBAR_RIGHT_MAX = 600;
export const SIDEBAR_RIGHT_DEFAULT = 440;

const THEME_STORAGE_KEY = 'ai-sheet:theme-mode';
const AGENT_MODEL_STORAGE_KEY = 'ai-sheet:agent-model';

function loadThemeMode(): ThemeMode {
  if (typeof window === 'undefined') return 'system';
  const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (raw === 'light' || raw === 'dark' || raw === 'system') return raw;
  return 'system';
}

function persistThemeMode(mode: ThemeMode) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(THEME_STORAGE_KEY, mode);
}

function loadAgentModelName(): string | null {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(AGENT_MODEL_STORAGE_KEY);
  return raw && raw.length > 0 ? raw : null;
}

function persistAgentModelName(name: string | null) {
  if (typeof window === 'undefined') return;
  if (name) {
    window.localStorage.setItem(AGENT_MODEL_STORAGE_KEY, name);
  } else {
    window.localStorage.removeItem(AGENT_MODEL_STORAGE_KEY);
  }
}

export const THEME_MODES: ReadonlyArray<ThemeMode> = ['system', 'light', 'dark'];

export function nextThemeMode(current: ThemeMode): ThemeMode {
  const idx = THEME_MODES.indexOf(current);
  return THEME_MODES[(idx + 1) % THEME_MODES.length];
}

interface UiStore {
  currentTab: AppTab;
  setCurrentTab: (tab: AppTab) => void;

  leftSidebarWidth: number;
  rightSidebarWidth: number;
  leftSidebarCollapsed: boolean;
  rightSidebarCollapsed: boolean;

  toggleLeftSidebar: () => void;
  toggleRightSidebar: () => void;
  setLeftSidebarWidth: (width: number) => void;
  setRightSidebarWidth: (width: number) => void;
  setRightSidebarCollapsed: (collapsed: boolean) => void;

  themeMode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => void;
  cycleThemeMode: () => void;

  selectedAgentModelName: string | null;
  setSelectedAgentModelName: (name: string | null) => void;
}

export const useUiStore = create<UiStore>((set, get) => ({
  currentTab: 'data',
  setCurrentTab: (tab) => set({ currentTab: tab }),

  leftSidebarWidth: SIDEBAR_LEFT_DEFAULT,
  rightSidebarWidth: SIDEBAR_RIGHT_DEFAULT,
  leftSidebarCollapsed: false,
  rightSidebarCollapsed: false,

  toggleLeftSidebar: () =>
    set((s) => ({ leftSidebarCollapsed: !s.leftSidebarCollapsed })),
  toggleRightSidebar: () =>
    set((s) => ({ rightSidebarCollapsed: !s.rightSidebarCollapsed })),
  setLeftSidebarWidth: (width) => set({ leftSidebarWidth: width }),
  setRightSidebarWidth: (width) => set({ rightSidebarWidth: width }),
  setRightSidebarCollapsed: (collapsed) => set({ rightSidebarCollapsed: collapsed }),

  themeMode: loadThemeMode(),
  setThemeMode: (mode) => {
    persistThemeMode(mode);
    set({ themeMode: mode });
  },
  cycleThemeMode: () => {
    const next = nextThemeMode(get().themeMode);
    persistThemeMode(next);
    set({ themeMode: next });
  },

  selectedAgentModelName: loadAgentModelName(),
  setSelectedAgentModelName: (name) => {
    persistAgentModelName(name);
    set({ selectedAgentModelName: name });
  },
}));
