import { create } from 'zustand';

export type AppTab = 'data' | 'formula' | 'ai' | 'config' | 'prompts';

export const SIDEBAR_LEFT_MIN = 48;
export const SIDEBAR_LEFT_MAX = 400;
export const SIDEBAR_LEFT_DEFAULT = 256;

export const SIDEBAR_RIGHT_MIN = 200;
export const SIDEBAR_RIGHT_MAX = 600;
export const SIDEBAR_RIGHT_DEFAULT = 384;

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
}

export const useUiStore = create<UiStore>((set) => ({
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
}));
