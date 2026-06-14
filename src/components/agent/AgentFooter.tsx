import { useEffect, useMemo, useState } from 'react';
import { getAppStatus } from '../../services/tauri';
import type { AppStatus } from '../../services/tauri';
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
  return 'var(--danger)';
}

export function AgentFooter() {
  const sessionStats = useAgentStore((s) => s.sessionStats);
  const status = useAgentStore((s) => s.status);
  const currentCwd = useExcelStore((s) => s.currentCwd);
  const skills = useSkillStore((s) => s.skills);
  const fetchSkills = useSkillStore((s) => s.fetchSkills);
  const selectedAgentModelName = useUiStore((s) => s.selectedAgentModelName);
  const [appStatus, setAppStatus] = useState<AppStatus | null>(null);

  useEffect(() => {
    if (skills.length === 0) {
      void fetchSkills();
    }
    void getAppStatus().then(setAppStatus);
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

  return (
    <div
      className="flex h-7 flex-shrink-0 items-center gap-2 overflow-hidden border-t px-3 text-[11px] leading-none"
      style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}
    >
      {/* 应用名 */}
      <span className="flex-shrink-0">
        {appStatus?.name ?? 'AI-Sheet'}
        <span className="ml-0.5" style={{ opacity: 0.6 }}>v{appStatus?.version ?? '0.1.0'}</span>
      </span>

      <span>·</span>

      {/* 工作目录 */}
      {cwdLabel && (
        <Tooltip text={currentCwd!} side="top">
          <span className="flex items-center gap-1 truncate max-w-[120px]" title={currentCwd!}>
            <span>📁</span>
            <span className="truncate">{cwdLabel}</span>
          </span>
        </Tooltip>
      )}

      {cwdLabel && <span>·</span>}

      {/* Token 用量 */}
      {sessionStats && (
        <>
          <Tooltip text={`输入 ${fmt(sessionStats.inputTokens)} tokens · 输出 ${fmt(sessionStats.outputTokens)} tokens`} side="top">
            <span className="flex items-center gap-1 whitespace-nowrap">
              <span style={{ color: 'var(--primary)' }}>↑{fmt(sessionStats.inputTokens)}</span>
              <span style={{ color: 'var(--success)' }}>↓{fmt(sessionStats.outputTokens)}</span>
            </span>
          </Tooltip>
          <span>·</span>
        </>
      )}

      {/* 上下文使用率 = inputTokens / contextWindow */}
      {sessionStats && sessionStats.contextWindow > 0 && sessionStats.inputTokens > 0 && (() => {
        const pct = Math.min(100, Math.round((sessionStats.inputTokens / sessionStats.contextWindow) * 100));
        return (
          <>
            <Tooltip text={`上下文 ${pct}% · ${sessionStats.inputTokens.toLocaleString()} / ${sessionStats.contextWindow.toLocaleString()}`} side="top">
              <span className="flex items-center gap-1 whitespace-nowrap">
                <span>📊</span>
                <span style={{ color: contextColor(pct) }}>
                  {pct}%
                </span>
              </span>
            </Tooltip>
            <span>·</span>
          </>
        );
      })()}

      {/* Skills */}
      {skillLabels.length > 0 && (
        <Tooltip
          text={skills.map((s) => s.name).join(', ')}
          side="top"
        >
          <span className="flex items-center gap-1 truncate max-w-[160px]">
            <span>🛠️</span>
            <span className="truncate">
              {skillLabels.join(', ')}
              {skillOverflow > 0 && <span style={{ color: 'var(--muted)' }}> +{skillOverflow}</span>}
            </span>
          </span>
        </Tooltip>
      )}

      {skillLabels.length > 0 && <span>·</span>}

      {/* 模型 */}
      {selectedAgentModelName && (
        <Tooltip text={`当前模型: ${selectedAgentModelName}`} side="top">
          <span className="flex items-center gap-1 truncate max-w-[120px]">
            <span>⚡</span>
            <span className="truncate">{selectedAgentModelName}</span>
          </span>
        </Tooltip>
      )}

      <div className="ml-auto flex items-center gap-1">
        <span
          className="inline-block h-1.5 w-1.5 rounded-full"
          style={{ background: isReady ? 'var(--success)' : 'var(--danger)' }}
        />
        <span>{isReady ? 'Ready' : 'Offline'}</span>
      </div>
    </div>
  );
}
