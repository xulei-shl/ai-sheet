import { useEffect, useMemo } from 'react';
import { Folder, Activity, Cpu, Wrench } from 'lucide-react';
import { getAppDataDir } from '../../services/tauri';
import { useAgentStore } from '../../stores/agentStore';
import { useExcelStore } from '../../stores/excelStore';
import { useSkillStore } from '../../stores/skillStore';
import { useUiStore } from '../../stores/uiStore';
import { Tooltip } from '../ui/Tooltip';

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function contextColor(pct: number): string {
  if (pct < 60) return 'var(--success)';
  if (pct < 85) return 'var(--warning)';
  return 'var(--error)';
}

export function AgentFooter() {
  const sessionStats = useAgentStore((s) => s.sessionStats);
  const status = useAgentStore((s) => s.status);
  const currentCwd = useExcelStore((s) => s.currentCwd);
  const skills = useSkillStore((s) => s.skills);
  const fetchSkills = useSkillStore((s) => s.fetchSkills);
  const selectedAgentModelName = useUiStore((s) => s.selectedAgentModelName);

  useEffect(() => {
    if (skills.length === 0) {
      void fetchSkills();
    }
    if (!currentCwd) {
      void getAppDataDir().then((dir) => useExcelStore.getState().setDefaultCwd(dir));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skills.length, fetchSkills]);

  const cwdLabel = useMemo(() => {
    if (!currentCwd) return null;
    const parts = currentCwd.replace(/\\/g, '/').split('/');
    return parts[parts.length - 1] || parts[parts.length - 2] || currentCwd;
  }, [currentCwd]);

  const skillLabels = useMemo(() => {
    return skills.slice(0, 3).map((s) => s.name);
  }, [skills]);

  const skillOverflow = skills.length > 3 ? skills.length - 3 : 0;

  const isReady = status?.ready ?? false;

  const contextPct = sessionStats && sessionStats.contextWindow > 0 && sessionStats.inputTokens > 0
    ? Math.min(100, Math.round((sessionStats.inputTokens / sessionStats.contextWindow) * 100))
    : null;

  return (
    <div
      className="flex h-[46px] flex-shrink-0 flex-col justify-center gap-1.5 overflow-hidden border-t px-3 text-[11px] leading-none"
      style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}
    >
      {/* Row 1: 模型 · 技能 · 状态 */}
      <div className="flex items-center gap-3 overflow-hidden">
        {selectedAgentModelName && (
          <Tooltip text={`当前模型: ${selectedAgentModelName}`} side="top">
            <span className="flex items-center gap-1.5 truncate max-w-[140px]">
              <Cpu size={12} style={{ color: 'var(--primary)', flexShrink: 0 }} />
              <span className="truncate" style={{ color: 'var(--ink)' }}>{selectedAgentModelName}</span>
            </span>
          </Tooltip>
        )}

        {skillLabels.length > 0 && (
          <Tooltip text={skills.map((s) => s.name).join(', ')} side="top">
            <span className="flex items-center gap-1.5 truncate max-w-[200px]">
              <Wrench size={11} style={{ flexShrink: 0, opacity: 0.7 }} />
              <span className="truncate">
                {skillLabels.join(', ')}
                {skillOverflow > 0 && <span style={{ opacity: 0.6 }}> +{skillOverflow}</span>}
              </span>
            </span>
          </Tooltip>
        )}

        <div className="ml-auto flex items-center gap-1.5">
          <span
            className="inline-block h-1.5 w-1.5 rounded-full"
            style={{ background: isReady ? 'var(--success)' : 'var(--error)' }}
          />
          <span>{isReady ? 'Ready' : 'Offline'}</span>
        </div>
      </div>

      {/* Row 2: 工作路径 · Token · 上下文 */}
      <div className="flex items-center gap-3 overflow-hidden">
        {cwdLabel && (
          <Tooltip text={currentCwd!} side="top">
            <span className="flex items-center gap-1.5 truncate max-w-[160px]" title={currentCwd!}>
              <Folder size={11} style={{ color: 'var(--warning)', flexShrink: 0 }} />
              <span className="truncate">{cwdLabel}</span>
            </span>
          </Tooltip>
        )}

        {sessionStats && (
          <Tooltip text={`输入 ${fmt(sessionStats.inputTokens)} tokens · 输出 ${fmt(sessionStats.outputTokens)} tokens`} side="top">
            <span className="flex items-center gap-2 whitespace-nowrap">
              <span className="flex items-center gap-1">
                <Activity size={10} style={{ color: 'var(--primary)', flexShrink: 0 }} />
                <span style={{ color: 'var(--primary)' }}>↑{fmt(sessionStats.inputTokens)}</span>
              </span>
              <span style={{ color: 'var(--success)' }}>↓{fmt(sessionStats.outputTokens)}</span>
            </span>
          </Tooltip>
        )}

        {contextPct !== null && (
          <Tooltip text={`上下文 ${contextPct}% · ${sessionStats!.inputTokens.toLocaleString()} / ${sessionStats!.contextWindow.toLocaleString()}`} side="top">
            <span className="whitespace-nowrap">
              <span style={{ color: contextColor(contextPct) }}>{contextPct}%</span>
            </span>
          </Tooltip>
        )}
      </div>
    </div>
  );
}
