import { create } from 'zustand';
import {
  clearActiveAgentModel,
  getAgentStatus,
  restartSidecar,
  sendAgentMessage,
  setActiveAgentModel,
  type ActiveAgentModel,
} from '../services/tauri';
import type { AgentMessage, AgentStatus, SidecarEvent, AgentContext } from '../types/agent';
import { useConfigStore } from './configStore';

interface AgentStore {
  messages: AgentMessage[];
  status: AgentStatus | null;
  error: string | null;
  isSending: boolean;
  isApplyingModel: boolean;
  appliedModelName: string | null;
  loadedContext: AgentContext | null;
  refreshStatus: () => Promise<void>;
  sendMessage: (content: string) => Promise<void>;
  restart: () => Promise<void>;
  applyModel: (name: string | null) => Promise<void>;
  handleEvent: (event: SidecarEvent) => void;
  markOffline: (message: string) => void;
  setLoadedContext: (context: AgentContext | null) => void;
  clearMessages: () => void;
}

export const useAgentStore = create<AgentStore>((set, get) => ({
  messages: [],
  status: null,
  error: null,
  isSending: false,
  isApplyingModel: false,
  appliedModelName: null,
  loadedContext: null,

  refreshStatus: async () => {
    const status = await getAgentStatus();
    set({ status, error: status.ready ? null : status.message });
  },

  sendMessage: async (content) => {
    const trimmed = content.trim();
    if (!trimmed) return;

    const userMessage: AgentMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: trimmed,
    };

    set((state) => ({
      messages: [...state.messages, userMessage],
      isSending: true,
      error: null,
    }));

    try {
      await sendAgentMessage(trimmed);
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : String(error),
        isSending: false,
      });
    }
  },

  restart: async () => {
    set({ error: null });
    await restartSidecar();
    await get().refreshStatus();
  },

  applyModel: async (name) => {
    const { appliedModelName, isApplyingModel } = get();
    if (isApplyingModel) return;
    if (appliedModelName === name) return;
    set({ isApplyingModel: true, error: null });
    try {
      if (name === null) {
        await clearActiveAgentModel();
      } else {
        const merged = useConfigStore.getState().getMergedModels();
        const target = merged.find((m) => m.name === name);
        if (!target) {
          throw new Error(`未找到模型: ${name}`);
        }
        const payload: ActiveAgentModel = {
          name: target.name,
          providerType: target.providerType,
          modelId: target.modelId,
          apiKey: target.apiKey,
          baseUrl: target.baseUrl,
        };
        await setActiveAgentModel(payload);
      }
      set({ appliedModelName: name });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : String(error),
        isApplyingModel: false,
      });
      return;
    }
    set({ isApplyingModel: false });
    void get().refreshStatus();
  },

  handleEvent: (event) => {
    if (event.type === 'agent_error') {
      set({ error: event.message, isSending: false });
      return;
    }

    if (event.type === 'agent_delta') {
      set((state) => {
        const last = state.messages[state.messages.length - 1];

        if (last?.role === 'assistant' && last.isStreaming) {
          return {
            messages: [
              ...state.messages.slice(0, -1),
              { ...last, content: `${last.content}${event.delta}` },
            ],
          };
        }

        return {
          messages: [
            ...state.messages,
            {
              id: `assistant-${event.id}`,
              role: 'assistant',
              content: event.delta,
              isStreaming: true,
            },
          ],
        };
      });
      return;
    }

    if (event.type === 'agent_done') {
      set((state) => ({
        isSending: false,
        messages: state.messages.map((message) =>
          message.role === 'assistant' && message.isStreaming
            ? { ...message, isStreaming: false }
            : message,
        ),
      }));
    }
  },

  markOffline: (message) => {
    set((state) => ({
      error: message,
      isSending: false,
      status: state.status ? { ...state.status, ready: false, message } : null,
    }));
  },

  setLoadedContext: (context) => {
    set({ loadedContext: context });
  },

  clearMessages: () => {
    set({ messages: [], error: null });
  },
}));
