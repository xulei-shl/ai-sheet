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
  Wrench,
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
import { ThemeToggle } from '../components/ui/ThemeToggle';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import { useTheme } from '../hooks/useTheme';
import logoDark from '../../assets/logo/ai-sheet-logo-dark.svg';
import logoLight from '../../assets/logo/ai-sheet-logo-light.svg';
import { DataPage } from '../pages/DataPage';
import { FormulaPage } from '../pages/FormulaPage';
import { AiPage } from '../pages/AiPage';
import { ConfigPage } from '../pages/ConfigPage';
import { PromptsPage } from '../pages/PromptsPage';
import { SkillsPage } from '../pages/SkillsPage';

const tabs: Array<{ id: AppTab; label: string; icon: typeof FileSpreadsheet; description: string }> = [
  { id: 'data', label: '数据加载', icon: FileSpreadsheet, description: '上传 Excel 文件，预览 Sheet 和列数据' },
  { id: 'formula', label: '公式处理', icon: Sigma, description: 'AI 辅助生成或手动输入公式，批量应用到指定列' },
  { id: 'ai', label: 'LLM 处理', icon: Bot, description: '提示词生成、LLM 批量处理和 Python 脚本执行' },
  { id: 'config', label: '配置管理', icon: Settings, description: '管理 LLM API 配置，支持自动降级' },
  { id: 'prompts', label: '提示词管理', icon: MessageSquare, description: '管理和复用已保存的提示词模板' },
  { id: 'skills', label: '技能管理', icon: Wrench, description: '查看、新增和删除 AI 技能工作流' },
];

function ResizableHandle({
  onResize,
  onDragStart,
  onDragEnd,
}: {
  onResize: (delta: number) => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
}) {
  const dragging = useRef(false);
  const rafId = useRef(0);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragging.current = true;
      onDragStart?.();
      const startX = e.clientX;

      const onMouseMove = (ev: MouseEvent) => {
        if (!dragging.current) return;
        cancelAnimationFrame(rafId.current);
        rafId.current = requestAnimationFrame(() => {
          onResize(ev.clientX - startX);
        });
      };

      const onMouseUp = () => {
        dragging.current = false;
        cancelAnimationFrame(rafId.current);
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        onDragEnd?.();
      };

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    },
    [onResize, onDragStart, onDragEnd],
  );

  return (
    <div
      className="group/handle relative z-10 w-1 flex-shrink-0 cursor-col-resize hover:w-1.5 hover:bg-[var(--primary)]/30 active:bg-[var(--primary)]/50 transition-colors"
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
  const resolvedTheme = useTheme();

  const handleRightResize = useSidebarResize(
    rightSidebarCollapsed, rightSidebarWidth, setRightSidebarWidth,
    SIDEBAR_RIGHT_MIN, SIDEBAR_RIGHT_MAX,
  );

  const [isDragging, setIsDragging] = useState(false);
  const [dragWidth, setDragWidth] = useState<number | null>(null);

  const handleDragStart = useCallback(() => {
    setIsDragging(true);
  }, []);

  const handleLeftDragResize = useCallback((delta: number) => {
    handleLeftResize(delta);
    setDragWidth(Math.min(SIDEBAR_LEFT_MAX, Math.max(SIDEBAR_LEFT_MIN, leftSidebarWidth + delta)));
  }, [handleLeftResize, leftSidebarWidth]);

  const handleRightDragResize = useCallback((delta: number) => {
    handleRightResize(-delta);
    setDragWidth(Math.min(SIDEBAR_RIGHT_MAX, Math.max(SIDEBAR_RIGHT_MIN, rightSidebarWidth - delta)));
  }, [handleRightResize, rightSidebarWidth]);

  const handleDragEnd = useCallback(() => {
    setIsDragging(false);
    setDragWidth(null);
  }, []);

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
        className={`flex flex-col overflow-hidden border-r ${isDragging ? '' : 'transition-[width] duration-200 ease-in-out'}`}
        style={{
          width: leftSidebarCollapsed ? 0 : leftSidebarWidth,
          borderColor: 'var(--border)',
        }}
        aria-label="主导航"
      >
        <header
          className="flex h-14 flex-shrink-0 items-center border-b px-5"
          style={{ borderColor: 'var(--border)' }}
        >
          <img
            src={resolvedTheme === 'dark' ? logoDark : logoLight}
            alt="AI-Sheet"
            className="h-7 w-auto flex-shrink-0"
          />
        </header>
        <div className="flex-1 overflow-y-auto p-3">
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
        <ResizableHandle onResize={handleLeftDragResize} onDragStart={handleDragStart} onDragEnd={handleDragEnd} />
      )}

      {/* ─── Center Content ─────────────────────────────────────────── */}
      <main className="relative flex min-w-0 flex-1 flex-col">
        <div className="flex h-14 flex-shrink-0 items-center justify-between border-b px-3" style={{ borderColor: 'var(--border)' }}>
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
                <div className="flex items-center gap-2 leading-none">
                  <h1 className="text-lg font-semibold whitespace-nowrap leading-none">{activeTab.label}</h1>
                  <span className="text-sm whitespace-nowrap leading-none" style={{ color: 'var(--muted)' }}>
                    {activeTab.description}
                  </span>
                </div>
              </div>
          <div className="flex items-center gap-1">
            <ThemeToggle />
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
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          {showSmallScreenWarning && (
            <div className="flex items-center gap-2 px-4 py-2 text-xs" style={{ background: 'var(--warning)', color: 'var(--ink)', opacity: 0.85 }}>
              <span>屏幕宽度不足，建议使用 1280px 以上屏幕以获得最佳体验</span>
            </div>
          )}
          {currentTab === 'data' && <DataPage />}
          {currentTab === 'formula' && <FormulaPage />}
          {currentTab === 'ai' && <AiPage />}
          {currentTab === 'config' && <ConfigPage />}
          {currentTab === 'prompts' && <PromptsPage />}
          {currentTab === 'skills' && <SkillsPage />}
        </div>
      </main>

      {/* ─── Right Sidebar ──────────────────────────────────────────── */}
      {!rightSidebarCollapsed && (
        <ResizableHandle onResize={handleRightDragResize} onDragStart={handleDragStart} onDragEnd={handleDragEnd} />
      )}
      <aside
        className={`flex flex-col overflow-hidden ${isDragging ? '' : 'transition-[width] duration-200 ease-in-out'}`}
        style={{
          width: rightSidebarCollapsed ? 0 : rightSidebarWidth,
          background: 'var(--bg)',
        }}
      >
        <AgentChatPanel />
      </aside>

      {/* Drag width indicator */}
      {isDragging && dragWidth !== null && (
        <div
          className="fixed top-3 left-1/2 -translate-x-1/2 z-50 rounded-md px-3 py-1.5 text-xs font-mono pointer-events-none"
          style={{ background: 'var(--surface)', color: 'var(--primary)', border: '1px solid var(--primary-glow)', boxShadow: '0 4px 12px rgba(0,0,0,0.2)' }}
        >
          {Math.round(dragWidth)}px
        </div>
      )}
    </div>
  );
}

