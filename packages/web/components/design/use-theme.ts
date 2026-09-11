'use client';
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { useEffect, useState } from 'react';

export type Theme = 'night' | 'day';

export const THEME_STORAGE_KEY = 'weir-theme';

export function useTheme(): { theme: Theme | null; toggle: () => void; label: string } {
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    setTheme(document.documentElement.getAttribute('data-theme') === 'day' ? 'day' : 'night');
  }, []);

  function toggle() {
    const next: Theme = theme === 'day' ? 'night' : 'day';
    setTheme(next);

    if (next === 'day') document.documentElement.setAttribute('data-theme', 'day');
    else document.documentElement.removeAttribute('data-theme');

    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      /* preference not persisted; this page is still correct */
    }
  }

  const label =
    theme === null ? 'Switch theme' : theme === 'day' ? 'Switch to night' : 'Switch to daylight';
  return { theme, toggle, label };
}
