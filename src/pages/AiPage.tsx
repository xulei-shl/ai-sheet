import { useState } from 'react';
import { Bot, FileCode, Sparkles, ChevronRight, Play } from 'lucide-react';
import { LLMProcessingPage } from './LLMProcessingPage';
import { useAgentStore } from '../stores/agentStore';

type AiSubTab = 'prompt-gen' | 'llm-batch';

export function AiPage() {
  const { searchParams } = new URL(window.location.href);
  const subParam = searchParams.get('sub') as AiSubTab | null;
  const [subTab, setSubTab] = useState<AiSubTab>(subParam || 'llm-batch');

  const updateUrl = (tab: AiSubTab) => {
    const url = new URL(window.location.href);
    url.searchParams.set('sub', tab);
    window.history.replaceState({}, '', url.toString());
    setSubTab(tab);
  };

  if (subTab === 'llm-batch') {
    return (
      <div className="flex h-full flex-col">
        <div className="flex items-center gap-2 border-b px-4 py-2" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
          <button onClick={() => updateUrl('prompt-gen')} className="text-xs" style={{ color: 'var(--muted)' }}>提示词生成</button>
          <ChevronRight className="h-3 w-3" style={{ color: 'var(--muted)' }} />
          <button onClick={() => updateUrl('llm-batch')} className="text-xs font-medium" style={{ color: 'var(--primary)' }}>LLM 批量处理</button>
        </div>
        <LLMProcessingPage />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b px-4 py-2" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
        <button onClick={() => updateUrl('prompt-gen')} className="text-xs font-medium" style={{ color: 'var(--primary)' }}>提示词生成</button>
        <ChevronRight className="h-3 w-3" style={{ color: 'var(--muted)' }} />
        <button onClick={() => updateUrl('llm-batch')} className="text-xs" style={{ color: 'var(--muted)' }}>LLM 批量处理</button>
      </div>
      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-2xl p-8">
          <div className="mb-8">
            <div className="mb-4 flex items-center gap-3">
              <Sparkles className="h-6 w-6" style={{ color: 'var(--primary)' }} />
              <h2 className="text-lg font-semibold" style={{ color: 'var(--ink)' }}>提示词生成</h2>
            </div>
            <p className="text-sm leading-relaxed" style={{ color: 'var(--muted)' }}>
              在右栏通过 AI 对话生成和优化提示词模板，保存后可在批量处理中复用。
            </p>
          </div>

          <div className="grid gap-4">
            <div className="flex items-start gap-4 rounded-lg p-4 transition-colors hover:opacity-80" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
              <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-md" style={{ background: 'var(--primary-glow)', color: 'var(--primary)' }}>
                <Sparkles className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-medium" style={{ color: 'var(--ink)' }}>提示词生成</h3>
                <p className="mt-1 text-xs leading-relaxed" style={{ color: 'var(--muted)' }}>
                  在右栏通过 AI 对话生成和优化提示词模板，保存后可在批量处理中复用。输入你的需求，AI 会帮你写出高质量的提示词。
                </p>
              </div>
            </div>

            <button
              onClick={() => updateUrl('llm-batch')}
              className="flex items-start gap-4 rounded-lg p-4 text-left transition-colors hover:opacity-80"
              style={{ background: 'var(--surface)', border: '1px solid var(--border)', cursor: 'pointer' }}
            >
              <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-md" style={{ background: 'var(--primary-glow)', color: 'var(--primary)' }}>
                <Bot className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-medium" style={{ color: 'var(--ink)' }}>LLM 批量处理</h3>
                <p className="mt-1 text-xs leading-relaxed" style={{ color: 'var(--muted)' }}>
                  选择已保存的提示词或自定义输入，对 Excel 数据逐行调用 AI 进行处理，支持暂停和续传。
                </p>
              </div>
              <ChevronRight className="mt-1 h-4 w-4 flex-shrink-0" style={{ color: 'var(--muted)' }} />
            </button>

            <div
              className="flex items-start gap-4 rounded-lg p-4"
              style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
            >
              <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-md" style={{ background: 'var(--primary-glow)', color: 'var(--primary)' }}>
                <FileCode className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-medium" style={{ color: 'var(--ink)' }}>Python 处理</h3>
                <p className="mt-1 text-xs leading-relaxed" style={{ color: 'var(--muted)' }}>
                  在右侧 AI 面板中对话，让 AI 为你编写并执行 Python 数据处理脚本，自动修复错误，支持 pandas 和 openpyxl。
                </p>
                <p className="mt-1 text-[10px] opacity-70" style={{ color: 'var(--muted)' }}>
                  提示：可在对话中使用 <code className="px-1 py-0.5 rounded" style={{ background: 'var(--bg)', fontFamily: 'monospace' }}>/skill:python-processing</code> 显式激活工作流
                </p>
                <button
                  onClick={() => {
                    useAgentStore.getState().sendMessage(
                      '我需要用 Python 处理 Excel 数据。请先查看已加载的数据结构，然后帮我编写处理脚本。如有必要，请使用 /skill:python-processing 工作流。'
                    );
                  }}
                  className="mt-3 inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-medium transition-opacity hover:opacity-80"
                  style={{ background: 'var(--primary)', color: 'white' }}
                >
                  <Play className="h-3 w-3" />
                  开始处理
                </button>
              </div>
            </div>
          </div>

          <div className="mt-6 rounded-lg p-4 text-center text-sm" style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--muted)' }}>
            请先在左侧"数据"页面上传 Excel 文件，然后在右栏通过 AI 对话开始处理
          </div>
        </div>
      </div>
    </div>
  );
}
