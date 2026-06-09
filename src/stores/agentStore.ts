import { create } from 'zustand';
import {
  clearActiveAgentModel,
  clearAgentContext,
  getAgentStatus,
  restartSidecar,
  sendAgentMessage,
  setActiveAgentModel,
  type ActiveAgentModel,
} from '../services/tauri';
import type { AgentMessage, AgentStatus, SidecarEvent, AgentContext } from '../types/agent';
import { useConfigStore } from './configStore';
import { useUiStore } from './uiStore';

interface AgentStore {
  messages: AgentMessage[];
  status: AgentStatus | null;
  error: string | null;
  agentStreamingRequestId: string | null;
  isApplyingModel: boolean;
  appliedModelName: string | null;
  loadedContext: AgentContext | null;

  refreshStatus: () => Promise<void>;
  sendMessage: (content: string, displayContent?: string, fullContent?: string) => Promise<void>;
  restart: () => Promise<void>;
  applyModel: (name: string | null) => Promise<void>;
  handleEvent: (event: SidecarEvent) => void;
  markOffline: (message: string) => void;
  setLoadedContext: (context: AgentContext | null) => void;
  clearMessages: () => void;
  deleteMessage: (id: string) => void;
  retryMessage: (id: string) => Promise<void>;
}

export const useAgentStore = create<AgentStore>((set, get) => ({
  messages: [],
  status: null,
  error: null,
  agentStreamingRequestId: null,
  isApplyingModel: false,
  appliedModelName: null,
  loadedContext: null,

  refreshStatus: async () => {
    const status = await getAgentStatus();
    const { isApplyingModel } = get();
    set({ status, error: isApplyingModel ? null : (status.ready ? null : status.message) });
  },

  sendMessage: async (content, displayContent, fullContent) => {
    const trimmed = content.trim();
    if (!trimmed) return;

    const pendingId = `msg-pending-${Date.now()}`;

    const userMessage: AgentMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: trimmed,
      displayContent,
      fullContent,
    };

    set((state) => ({
      messages: [...state.messages, userMessage],
      agentStreamingRequestId: pendingId,
      error: null,
    }));

    try {
      await sendAgentMessage(fullContent ?? trimmed);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      set((s) => ({
        error: errorMsg,
        agentStreamingRequestId: null,
        messages: [...s.messages, {
          id: `error-${Date.now()}`,
          role: 'assistant' as const,
          content: errorMsg,
          isError: true,
        }],
      }));
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
        await get().refreshStatus();
        set({ appliedModelName: null, isApplyingModel: false });
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
          useProxy: target.useProxy,
        };
        await setActiveAgentModel(payload);
      }
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : String(error),
        isApplyingModel: false,
      });
    }
  },

  handleEvent: (event) => {
    if (event.type === 'agent_error') {
      if (event.id) {
        set((s) => {
          const existing = s.messages.find((m) => m.requestId === event.id && m.role === 'assistant');
          if (existing) {
            const messages = s.messages.map((m) =>
              m.requestId === event.id && m.role === 'assistant'
                ? { ...m, content: event.message, isStreaming: false, isError: true }
                : m,
            );
            return { messages, agentStreamingRequestId: null };
          }
          return {
            messages: [
              ...s.messages,
              {
                id: `error-${event.id}`,
                requestId: event.id,
                role: 'assistant' as const,
                content: event.message,
                isError: true,
              },
            ],
            agentStreamingRequestId: null,
          };
        });
      } else {
        set((s) => ({
          messages: [
            ...s.messages,
            {
              id: `error-${Date.now()}`,
              role: 'assistant' as const,
              content: event.message,
              isError: true,
            },
          ],
        }));
      }
      return;
    }

    if (event.type === 'agent_delta' && event.id && event.delta) {
      set((s) => {
        const idx = s.messages.findIndex((m) => m.requestId === event.id);
        if (idx === -1) {
          return {
            messages: [
              ...s.messages,
              {
                id: `assistant-${event.id}`,
                requestId: event.id,
                role: 'assistant' as const,
                content: event.delta,
                isStreaming: true,
                isWaitingForFirstToken: false,
                toolCalls: [],
              },
            ],
          };
        }
        const arr = [...s.messages];
        arr[idx] = { ...arr[idx], content: arr[idx].content + event.delta, isWaitingForFirstToken: false };
        return { messages: arr };
      });
      return;
    }

    if (event.type === 'agent_tool_start' && event.id) {
      set((s) => {
        const idx = s.messages.findIndex((m) => m.requestId === event.id && m.role === 'assistant');
        if (idx === -1) return {};
        const messages = [...s.messages];
        const msg = messages[idx];
        const newToolCall = {
          id: `${event.tool}-${Date.now()}`,
          tool: event.tool,
          args: event.args,
          status: 'running' as const,
          startTime: Date.now(),
        };
        messages[idx] = {
          ...msg,
          toolCalls: [...(msg.toolCalls || []), newToolCall],
          isWaitingForFirstToken: false,
        };
        return { messages };
      });
      return;
    }

    if (event.type === 'agent_tool_end' && event.id) {
      set((s) => {
        const idx = s.messages.findIndex((m) => m.requestId === event.id && m.role === 'assistant');
        if (idx === -1) return {};
        const messages = [...s.messages];
        const msg = messages[idx];
        const toolCalls = msg.toolCalls || [];
        const toolCallIdx = (() => {
  for (let i = toolCalls.length - 1; i >= 0; i--) {
    if (toolCalls[i].tool === event.tool && toolCalls[i].status === 'running') return i;
  }
  return -1;
})();
        if (toolCallIdx !== -1) {
          const updated = [...toolCalls];
          updated[toolCallIdx] = {
            ...updated[toolCallIdx],
            status: 'completed' as const,
            result: event.result,
            endTime: Date.now(),
          };
          messages[idx] = { ...msg, toolCalls: updated };
        }
        return { messages };
      });
      return;
    }

    if (event.type === 'agent_done' && event.id) {
      set((s) => ({
        messages: s.messages.map((m) =>
          m.requestId === event.id ? { ...m, isStreaming: false } : m,
        ),
        agentStreamingRequestId: null,
      }));
      return;
    }

    if (event.type === 'model_switch_result') {
      if (event.success) {
        set({ appliedModelName: event.modelName ?? null, isApplyingModel: false, error: null });
      } else {
        useUiStore.getState().setSelectedAgentModelName(get().appliedModelName);
        set({ error: event.error ?? '模型切换失败', isApplyingModel: false });
      }
      return;
    }
  },

  markOffline: (message) => {
    const { isApplyingModel } = get();
    set((state) => ({
      error: isApplyingModel ? state.error : message,
      agentStreamingRequestId: null,
      status: state.status ? { ...state.status, ready: false, message } : null,
    }));
  },

  setLoadedContext: (context) => {
    set({ loadedContext: context });
  },

  clearMessages: () => {
    set({ messages: [], error: null });
    clearAgentContext();
  },

  deleteMessage: (id) => {
    const { messages, agentStreamingRequestId } = get();
    const idx = messages.findIndex((m) => m.id === id);
    if (idx === -1) return;
    const removed = messages.slice(idx);
    const clears: Record<string, null> = {};
    if (removed.some((m) => m.requestId === agentStreamingRequestId)) {
      clears.agentStreamingRequestId = null;
    }
    set({ messages: messages.slice(0, idx), ...clears });
  },

  retryMessage: async (id) => {
    const state = get();
    const idx = state.messages.findIndex((m) => m.id === id);
    if (idx === -1) return;
    const msg = state.messages[idx];
    if (msg.role !== 'assistant') return;

    const userMsg = state.messages[idx - 1];
    if (!userMsg || userMsg.role !== 'user') return;

    set({ messages: state.messages.slice(0, idx), error: null });

    const pendingId = `msg-pending-${Date.now()}`;
    set({ agentStreamingRequestId: pendingId });

    try {
      await sendAgentMessage(userMsg.fullContent ?? userMsg.content);
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : String(error),
        agentStreamingRequestId: null,
      });
    }
  },
}));

