import {
  Bot,
  ChevronLeft,
  ChevronRight,
  FileSpreadsheet,
  MessageSquare,
  PanelLeftClose,
  PanelRightClose,
  Settings,
  Sigma,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  useUiStore,
  type AppTab,
  SIDEBAR_LEFT_MIN,
  SIDEBAR_LEFT_MAX,
  SIDEBAR_RIGHT_MIN,
  SIDEBAR_RIGHT_MAX,
} from '../stores/uiStore';
import { AgentChatPanel } from '../components/agent/AgentChatPanel';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import { DataPage } from '../pages/DataPage';
import { FormulaPage } from '../pages/FormulaPage';
import { AiPage } from '../pages/AiPage';
import { ConfigPage } from '../pages/ConfigPage';
import { PromptsPage } from '../pages/PromptsPage';

const tabs: Array<{ id: AppTab; label: string; icon: typeof FileSpreadsheet; description: string }> = [
  { id: 'data', label: '数据加载', icon: FileSpreadsheet, description: '上传 Excel 文件，预览 Sheet 和列数据。' },
  { id: 'formula', label: '公式处理', icon: Sigma, description: 'AI 辅助生成或手动输入公式，批量应用到指定列。' },
  { id: 'ai', label: 'LLM 处理', icon: Bot, description: '提示词生成、LLM 批量处理和 Python 脚本执行。' },
  { id: 'config', label: '配置管理', icon: Settings, description: '管理 LLM API 配置，支持自动降级。' },
  { id: 'prompts', label: '提示词管理', icon: MessageSquare, description: '管理和复用已保存的提示词模板。' },
];

function ResizableHandle({ onResize }: { onResize: (delta: number) => void }) {
  const dragging = useRef(false);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragging.current = true;
      const startX = e.clientX;

      const onMouseMove = (ev: MouseEvent) => {
        if (!dragging.current) return;
        onResize(ev.clientX - startX);
      };

      const onMouseUp = () => {
        dragging.current = false;
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    },
    [onResize],
  );

  return (
    <div
      className="relative z-10 w-px flex-shrink-0 cursor-col-resize transition-colors hover:w-0.5 hover:bg-[var(--primary)]/40 active:bg-[var(--primary)]/60"
      style={{ background: 'var(--border)' }}
      onMouseDown={onMouseDown}
    />
  );
}

function useSidebarResize(
  collapsed: boolean,
  width: number,
  setWidth: (w: number) => void,
  min: number,
  max: number,
) {
  return useCallback(
    (delta: number) => {
      if (collapsed) return;
      setWidth(Math.min(max, Math.max(min, width + delta)));
    },
    [collapsed, width, setWidth, min, max],
  );
}

function TabIcon({ icon: Icon }: { icon: typeof FileSpreadsheet }) {
  return <Icon className="h-4 w-4 flex-shrink-0" aria-hidden="true" />;
}

export function AppLayout() {
  const {
    currentTab,
    leftSidebarCollapsed,
    leftSidebarWidth,
    rightSidebarCollapsed,
    rightSidebarWidth,
    setCurrentTab,
    setLeftSidebarWidth,
    setRightSidebarWidth,
    setRightSidebarCollapsed,
    toggleLeftSidebar,
    toggleRightSidebar,
  } = useUiStore();

  const activeTab = tabs.find((tab) => tab.id === currentTab) ?? tabs[0];

  const handleLeftResize = useSidebarResize(
    !leftSidebarCollapsed, leftSidebarWidth, setLeftSidebarWidth,
    SIDEBAR_LEFT_MIN, SIDEBAR_LEFT_MAX,
  );
  useKeyboardShortcuts();

  const handleRightResize = useSidebarResize(
    rightSidebarCollapsed, rightSidebarWidth, setRightSidebarWidth,
    SIDEBAR_RIGHT_MIN, SIDEBAR_RIGHT_MAX,
  );

  // Responsive layout: auto-collapse right sidebar below 1280px
  const [windowWidth, setWindowWidth] = useState(window.innerWidth);
  useEffect(() => {
    const onResize = () => {
      const w = window.innerWidth;
      setWindowWidth(w);
      if (w < 1280) setRightSidebarCollapsed(true);
    };
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const showSmallScreenWarning = windowWidth < 1024;

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: 'var(--bg)', color: 'var(--ink)' }}>
      {/* ─── Left Sidebar ───────────────────────────────────────────── */}
      <nav
        className="flex flex-col overflow-hidden border-r transition-[width] duration-200 ease-in-out"
        style={{
          width: leftSidebarCollapsed ? 0 : leftSidebarWidth,
          borderColor: 'var(--border)',
        }}
        aria-label="主导航"
      >
        <div className="flex flex-1 flex-col p-3">
          <div className="mb-6 px-2">
            <div className="text-lg font-semibold whitespace-nowrap">AI-Sheet</div>
            <div className="text-xs whitespace-nowrap" style={{ color: 'var(--muted)' }}>
              Modern desktop data agent
            </div>
          </div>
          <div className="space-y-1">
            {tabs.map((tab) => {
              const isActive = tab.id === currentTab;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setCurrentTab(tab.id)}
                  className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm whitespace-nowrap transition-colors"
                  style={{
                    background: isActive ? 'var(--surface)' : 'transparent',
                    color: isActive ? 'var(--ink)' : 'var(--muted)',
                  }}
                >
                  <TabIcon icon={tab.icon} />
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>
      </nav>

      {!leftSidebarCollapsed && (
        <ResizableHandle onResize={handleLeftResize} />
      )}

      {/* ─── Center Content ─────────────────────────────────────────── */}
      <main className="relative flex min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between border-b p-3" style={{ borderColor: 'var(--border)' }}>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={toggleLeftSidebar}
              className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded transition-colors hover:bg-[var(--surface-hover)]"
              style={{ color: 'var(--muted)' }}
              aria-label={leftSidebarCollapsed ? '显示导航' : '隐藏导航'}
            >
              {leftSidebarCollapsed ? (
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
              ) : (
                <PanelLeftClose className="h-4 w-4" aria-hidden="true" />
              )}
            </button>
            <div className="flex items-center gap-3">
              <h1 className="text-lg font-semibold whitespace-nowrap">{activeTab.label}</h1>
              <span className="text-sm whitespace-nowrap" style={{ color: 'var(--muted)' }}>
                {activeTab.description}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={toggleRightSidebar}
            className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded transition-colors hover:bg-[var(--surface-hover)]"
            style={{ color: 'var(--muted)' }}
            aria-label={rightSidebarCollapsed ? '显示 AI 面板' : '隐藏 AI 面板'}
          >
            {rightSidebarCollapsed ? (
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            ) : (
              <PanelRightClose className="h-4 w-4" aria-hidden="true" />
            )}
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          {showSmallScreenWarning && (
            <div className="flex items-center gap-2 px-4 py-2 text-xs" style={{ background: 'oklch(0.7 0.12 80 / 0.15)', color: 'oklch(0.5 0.1 80)' }}>
              <span>屏幕宽度不足，建议使用 1280px 以上屏幕以获得最佳体验</span>
            </div>
          )}
          {currentTab === 'data' && <DataPage />}
          {currentTab === 'formula' && <FormulaPage />}
          {currentTab === 'ai' && <AiPage />}
          {currentTab === 'config' && <ConfigPage />}
          {currentTab === 'prompts' && <PromptsPage />}
        </div>
      </main>

      {/* ─── Right Sidebar ──────────────────────────────────────────── */}
      {!rightSidebarCollapsed && (
        <ResizableHandle onResize={(delta) => handleRightResize(-delta)} />
      )}
      <aside
        className="flex flex-col overflow-hidden transition-[width] duration-200 ease-in-out"
        style={{
          width: rightSidebarCollapsed ? 0 : rightSidebarWidth,
          background: 'var(--bg)',
        }}
      >
        <AgentChatPanel />
      </aside>
    </div>
  );
}

