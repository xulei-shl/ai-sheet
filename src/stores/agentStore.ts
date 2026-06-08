import { create } from 'zustand';
import {
  clearActiveAgentModel,
  getAgentStatus,
  restartSidecar,
  sendAgentMessage,
  sendDirectLlmMessage as sendDirectLlmMessageRust,
  setActiveAgentModel,
  type ActiveAgentModel,
  type DirectLlmRequest,
} from '../services/tauri';
import type { AgentMessage, AgentStatus, SidecarEvent, AgentContext } from '../types/agent';
import { useConfigStore } from './configStore';

function resolveRequestKind(id: string): 'agent' | 'direct' {
  return id.startsWith('direct-') ? 'direct' : 'agent';
}

interface AgentStore {
  messages: AgentMessage[];
  status: AgentStatus | null;
  error: string | null;
  agentStreamingRequestId: string | null;
  directStreamingRequestId: string | null;
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
  sendDirectLlmMessage: (action: 'formula_generation' | 'prompt_generation', userDisplay: string, fullPrompt: string) => Promise<void>;
}

export const useAgentStore = create<AgentStore>((set, get) => ({
  messages: [],
  status: null,
  error: null,
  agentStreamingRequestId: null,
  directStreamingRequestId: null,
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

    const pendingId = `msg-pending-${Date.now()}`;

    const userMessage: AgentMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: trimmed,
    };

    set((state) => ({
      messages: [...state.messages, userMessage],
      agentStreamingRequestId: pendingId,
      error: null,
    }));

    try {
      await sendAgentMessage(trimmed);
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : String(error),
        agentStreamingRequestId: null,
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
      set({ error: event.message });
      if (event.id) {
        const kind = resolveRequestKind(event.id);
        set((s) => ({
          messages: s.messages.map((m) =>
            m.requestId === event.id ? { ...m, isStreaming: false } : m,
          ),
          [kind === 'agent'
            ? 'agentStreamingRequestId'
            : 'directStreamingRequestId']: null,
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
              },
            ],
          };
        }
        const arr = [...s.messages];
        arr[idx] = { ...arr[idx], content: arr[idx].content + event.delta };
        return { messages: arr };
      });
      return;
    }

    if (event.type === 'agent_done' && event.id) {
      set((s) => ({
        messages: s.messages.map((m) =>
          m.requestId === event.id ? { ...m, isStreaming: false } : m,
        ),
        [resolveRequestKind(event.id) === 'agent'
          ? 'agentStreamingRequestId'
          : 'directStreamingRequestId']: null,
      }));
    }
  },

  markOffline: (message) => {
    set((state) => ({
      error: message,
      agentStreamingRequestId: null,
      directStreamingRequestId: null,
      status: state.status ? { ...state.status, ready: false, message } : null,
    }));
  },

  setLoadedContext: (context) => {
    set({ loadedContext: context });
  },

  clearMessages: () => {
    set({ messages: [], error: null });
  },

  sendDirectLlmMessage: async (action, userDisplay, fullPrompt) => {
    const { status, directStreamingRequestId } = get();
    if (directStreamingRequestId) throw new Error('direct LLM 正在生成中');
    if (!status?.ready) throw new Error('Sidecar 未就绪');

    const { loadedContext } = get();
    if (!loadedContext?.loadedFiles?.length) throw new Error('未加载 Excel 上下文');

    const first = loadedContext.loadedFiles[0];
    const context: DirectLlmRequest['context'] = {
      fileName: first.path,
      sheets: first.sheets.map((s) => ({ sheet: s.sheetName, columns: s.columns.map((c) => `${c.letter}(${c.name})`) })),
    };

    const requestId = `direct-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    const userMsg: AgentMessage = {
      id: `user-${requestId}`,
      requestId,
      role: 'user',
      content: userDisplay,
      displayContent: userDisplay,
      fullContent: fullPrompt,
    };
    const assistantMsg: AgentMessage = {
      id: `assistant-${requestId}`,
      requestId,
      role: 'assistant',
      content: '',
      isStreaming: true,
    };

    set((s) => ({
      messages: [...s.messages, userMsg, assistantMsg],
      directStreamingRequestId: requestId,
      error: null,
    }));

    try {
      await sendDirectLlmMessageRust({
        requestId,
        action,
        content: fullPrompt,
        context,
      });
    } catch (error) {
      set((s) => ({
        error: error instanceof Error ? error.message : String(error),
        messages: s.messages.map((m) =>
          m.requestId === requestId ? { ...m, isStreaming: false } : m,
        ),
        directStreamingRequestId: null,
      }));
    }
  },
}));
