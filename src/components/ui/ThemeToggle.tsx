import { Monitor, Moon, Sun } from 'lucide-react';
import { useUiStore, type ThemeMode } from '../../stores/uiStore';
import { useTheme } from '../../hooks/useTheme';

const META: Record<ThemeMode, { label: string; icon: typeof Sun; nextLabel: string }> = {
  system: { label: '跟随系统', icon: Monitor, nextLabel: '当前：跟随系统（点击切换到浅色）' },
  light: { label: '浅色模式', icon: Sun, nextLabel: '当前：浅色模式（点击切换到深色）' },
  dark: { label: '深色模式', icon: Moon, nextLabel: '当前：深色模式（点击切换到跟随系统）' },
};

export function ThemeToggle() {
  const themeMode = useUiStore((s) => s.themeMode);
  const cycleThemeMode = useUiStore((s) => s.cycleThemeMode);
  const resolved = useTheme();

  const { label, icon: Icon } = META[themeMode];

  return (
    <button
      type="button"
      onClick={cycleThemeMode}
      title={label}
      aria-label={`主题：${label}（点击切换）`}
      className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded transition-colors hover:bg-[var(--surface-hover)]"
      style={{ color: 'var(--muted)' }}
    >
      <Icon
        className="h-4 w-4 transition-transform duration-200"
        aria-hidden="true"
        data-resolved={resolved}
      />
    </button>
  );
}
