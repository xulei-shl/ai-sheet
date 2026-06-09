import { create } from 'zustand';
import {
  clearActiveAgentModel,
  clearAgentContext,
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
import { useUiStore } from './uiStore';

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
  deleteMessage: (id: string) => void;
  retryMessage: (id: string) => Promise<void>;
  sendDirectLlmMessage: (action: string, userDisplay: string, fullPrompt: string) => Promise<void>;
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
    const { isApplyingModel } = get();
    set({ status, error: isApplyingModel ? null : (status.ready ? null : status.message) });
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

    // 预创建一个等待中的 assistant 消息，用于显示等待动效
    const pendingAssistantMessage: AgentMessage = {
      id: `assistant-${pendingId}`,
      requestId: pendingId,
      role: 'assistant',
      content: '',
      isStreaming: true,
      isWaitingForFirstToken: true,
      toolCalls: [],
    };
    set((state) => ({
      messages: [...state.messages, pendingAssistantMessage],
    }));

    try {
      await sendAgentMessage(trimmed);
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
        // isApplyingModel 保持 true，等 model_switch_result 事件回来后再清除
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
        const kind = resolveRequestKind(event.id);
        set((s) => {
          const existing = s.messages.find((m) => m.requestId === event.id && m.role === 'assistant');
          if (existing) {
            // 找到对应的 assistant 消息，将其内容替换为错误信息
            const messages = s.messages.map((m) =>
              m.requestId === event.id && m.role === 'assistant'
                ? { ...m, content: event.message, isStreaming: false, isError: true }
                : m,
            );
            return {
              messages,
              [kind === 'agent'
                ? 'agentStreamingRequestId'
                : 'directStreamingRequestId']: null,
            };
          }
          // 没有找到匹配的 assistant 消息（如 LLM 超时，从未收到 agent_delta），
          // 需要新建一条错误消息
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
            [kind === 'agent'
              ? 'agentStreamingRequestId'
              : 'directStreamingRequestId']: null,
          };
        });
      } else {
        // 没有 id 的错误（如初始化错误）也显示在消息列表中
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
        const toolCallIdx = toolCalls.findLastIndex((tc) => tc.tool === event.tool && tc.status === 'running');
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
        [resolveRequestKind(event.id) === 'agent'
          ? 'agentStreamingRequestId'
          : 'directStreamingRequestId']: null,
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
      directStreamingRequestId: null,
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
    const { messages, agentStreamingRequestId, directStreamingRequestId } = get();
    const idx = messages.findIndex((m) => m.id === id);
    if (idx === -1) return;
    const removed = messages.slice(idx);
    const clears: Record<string, null> = {};
    if (removed.some((m) => m.requestId === agentStreamingRequestId)) {
      clears.agentStreamingRequestId = null;
    }
    if (removed.some((m) => m.requestId === directStreamingRequestId)) {
      clears.directStreamingRequestId = null;
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
      await sendAgentMessage(userMsg.content);
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : String(error),
        agentStreamingRequestId: null,
      });
    }
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
      const errorMsg = error instanceof Error ? error.message : String(error);
      set((s) => ({
        error: errorMsg,
        messages: s.messages.map((m) =>
          m.requestId === requestId ? { ...m, content: m.content || errorMsg, isStreaming: false, isError: true } : m,
        ),
        directStreamingRequestId: null,
      }));
    }
  },
}));
