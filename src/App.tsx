import { useEffect, useState } from 'react';
import { AppLayout } from './layouts/AppLayout';
import { getActiveModel, getAppStatus, type AppStatus } from './services/tauri';
import { useUiStore } from './stores/uiStore';
import type { ModelConfig } from './types/config';

export function App() {
  const [appStatus, setAppStatus] = useState<AppStatus | null>(null);
  const [activeModel, setActiveModel] = useState<ModelConfig | null>(null);
  const selectedAgentModelName = useUiStore((s) => s.selectedAgentModelName);

  useEffect(() => {
    void Promise.all([getAppStatus(), getActiveModel()]).then(([status, model]) => {
      setAppStatus(status);
      setActiveModel(model);
    });
  }, []);

  const displayedModelName = selectedAgentModelName ?? activeModel?.name ?? '加载中';

  return (
    <div className="h-full">
      <AppLayout />
      <div className="fixed bottom-3 left-3 rounded-md border px-3 py-2 text-xs" style={{ borderColor: 'var(--border)', background: 'var(--surface)', color: 'var(--muted)' }}>
        {appStatus?.name ?? 'AI-Sheet'} v{appStatus?.version ?? '0.1.0'} · 当前模型：{displayedModelName}
      </div>
    </div>
  );
}
