'use client';
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { useEffect, useState } from 'react';

export type Theme = 'night' | 'day';

/** The key the inline script in `app/layout.tsx` reads before first paint. Change both together. */
export const THEME_STORAGE_KEY = 'weir-theme';

/**
 * Night and daylight, as a hook rather than a component.
 *
 * The initial value is read from the DOM rather than from storage, because an inline script in the
 * root layout already resolved it before paint. Reading storage again here would put one decision in
 * two places, and the second would eventually disagree.
 */
export function useTheme(): { theme: Theme | null; toggle: () => void; label: string } {
  /* `null` is "not yet known". The server cannot know the choice, so any concrete initial value
     would be wrong for half the audience and would flip after hydration. */
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    setTheme(document.documentElement.getAttribute('data-theme') === 'day' ? 'day' : 'night');
  }, []);

  function toggle() {
    const next: Theme = theme === 'day' ? 'night' : 'day';
    setTheme(next);

    // Night is the *absence* of the attribute, matching the stylesheet, where `:root` is night and
    // `:root[data-theme="day"]` is the override.
    if (next === 'day') document.documentElement.setAttribute('data-theme', 'day');
    else document.documentElement.removeAttribute('data-theme');

    /* Storage throws in some privacy modes. The theme is already applied, so a failure costs the
       preference on the next visit and nothing on this one — swallowing it is right. */
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
