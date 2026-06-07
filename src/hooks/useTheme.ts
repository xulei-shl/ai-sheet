import { useEffect, useState } from 'react';
import { useUiStore, type ResolvedTheme, type ThemeMode } from '../stores/uiStore';

const MEDIA_QUERY = '(prefers-color-scheme: dark)';

function getSystemTheme(): ResolvedTheme {
  if (typeof window === 'undefined' || !window.matchMedia) return 'dark';
  return window.matchMedia(MEDIA_QUERY).matches ? 'dark' : 'light';
}

function resolveTheme(mode: ThemeMode): ResolvedTheme {
  return mode === 'system' ? getSystemTheme() : mode;
}

/**
 * Subscribes to the current theme mode and mirrors it to the
 * `data-theme-mode` attribute on <html>. The returned resolved
 * theme is the concrete value the UI should react to (i.e.
 * "system" has been mapped to "light" or "dark").
 */
export function useTheme(): ResolvedTheme {
  const themeMode = useUiStore((s) => s.themeMode);
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(() => getSystemTheme());
  const [resolved, setResolved] = useState<ResolvedTheme>(() => resolveTheme(themeMode));

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia(MEDIA_QUERY);
    const onChange = (e: MediaQueryListEvent) => {
      setSystemTheme(e.matches ? 'dark' : 'light');
    };
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    const next = themeMode === 'system' ? systemTheme : themeMode;
    setResolved(next);
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-theme-mode', next);
    }
  }, [themeMode, systemTheme]);

  return resolved;
}
