'use client';
// Built-by: @projectx.sui · Co-authored-by: Claude

/**
 * Night and daylight.
 *
 * # The default is a decision, not an omission
 *
 * # Why this component does not decide the first frame
 *
 * The attribute is already on `<html>` before this mounts — an inline script in the root layout
 * reads `localStorage` in `<head>`. That is the only way to avoid a flash: an effect runs after
 * paint, so a reader who chose daylight would see the night ground first on every visit.
 *
 * So this component's initial state is read from the DOM rather than from storage, because the DOM
 * is what the script already resolved. Reading storage again here would put the decision in two
 * places, and the second one would eventually disagree with the first.
 */

import { useEffect, useState } from 'react';

export type Theme = 'night' | 'day';

/** The key the inline script in `app/layout.tsx` reads. Changing it here means changing it there. */
export const THEME_STORAGE_KEY = 'weir-theme';

export function ThemeToggle() {
  /*
    Starts as `null` — "not yet known" — rather than guessing `night`.

    The server cannot know the reader's choice, so any concrete initial value would be wrong for half
    the audience and would render the wrong icon until hydration corrected it. `null` commits to
    neither, and the effect settles it on mount.
  */
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    setTheme(document.documentElement.getAttribute('data-theme') === 'day' ? 'day' : 'night');
  }, []);

  function toggle() {
    const next: Theme = theme === 'day' ? 'night' : 'day';
    setTheme(next);

    // Night is the *absence* of the attribute, matching the inline script and the stylesheet, where
    // `:root` is night and `:root[data-theme="day"]` is the override.
    if (next === 'day') document.documentElement.setAttribute('data-theme', 'day');
    else document.documentElement.removeAttribute('data-theme');

    /*
      Storage can throw — Safari private browsing, a blocked third-party context, a full quota. The
      theme has already been applied above, so a failure here costs the reader their preference on
      the next visit and nothing on this one. Swallowing it is right; letting it propagate would
      break the click that did work.
    */
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      /* preference not persisted; this page is still correct */
    }
  }

  const isDay = theme === 'day';
  const label = theme === null ? 'Switch theme' : isDay ? 'Switch to night' : 'Switch to daylight';

  return (
    <button
      type="button"
      className="weir-theme-toggle"
      onClick={toggle}
      aria-label={label}
      title={label}
    >
      {/*
        The icon is the destination rather than the current state — a sun means "go to daylight".
        Both are drawn in the mark's own geometry: 24px grid, 1.55 stroke, round caps.

        Nothing is drawn until the theme is known, so the button never shows the wrong icon for a
        frame and then swaps. It keeps its size either way, so the header does not reflow.
      */}
      <svg
        viewBox="0 0 24 24"
        width="18"
        height="18"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.55"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        {theme === null ? null : isDay ? (
          /* A moon: the reader is in daylight, so the offer is night. */
          <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" />
        ) : (
          <>
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
          </>
        )}
      </svg>
    </button>
  );
}
