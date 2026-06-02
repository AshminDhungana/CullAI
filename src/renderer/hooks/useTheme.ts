import { useEffect, useState, useCallback } from 'react';

type Theme = 'light' | 'dark' | 'system';

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>('system');
  const [isDark, setIsDark] = useState(false);

  // Load persisted preference
  useEffect(() => {
    async function load() {
      try {
        // @ts-expect-error
        const stored = await window.electronAPI?.getSettings?.();
        if (stored?.theme) {
          setThemeState(stored.theme);
        } else {
          // Default to dark for this app
          setThemeState('dark');
        }
      } catch {
        setThemeState('dark');
      }
    }
    load();
  }, []);

  // Apply class to <html> and track isDark
  useEffect(() => {
    const root = document.documentElement;
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    const applyTheme = () => {
      const systemDark = mediaQuery.matches;
      const isDarkMode = theme === 'system' ? systemDark : theme === 'dark';

      if (isDarkMode) {
        root.classList.add('dark');
      } else {
        root.classList.remove('dark');
      }
      setIsDark(isDarkMode);
    };

    applyTheme();

    const handler = () => {
      if (theme === 'system') applyTheme();
    };
    mediaQuery.addEventListener('change', handler);
    return () => mediaQuery.removeEventListener('change', handler);
  }, [theme]);

  const setTheme = useCallback((newTheme: Theme) => {
    setThemeState(newTheme);
    try {
      // @ts-expect-error
      window.electronAPI?.saveSettings?.({ theme: newTheme });
    } catch {}
  }, []);

  const toggle = useCallback(() => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  }, [setTheme]);

  return { theme, setTheme, toggle, isDark };
}