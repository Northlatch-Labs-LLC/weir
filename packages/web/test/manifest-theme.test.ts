// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (p: string): string => readFileSync(join(process.cwd(), p), 'utf8');

const manifest = JSON.parse(read('public/site.webmanifest')) as {
  display: string;
  theme_color: string;
  background_color: string;
};

/*
  Three places name the page colour and one names the app's chrome: the manifest's theme_color and
  background_color, the viewport's themeColor, and `--bg` in the stylesheet. They were allowed to
  drift once already — the manifest said #04161d while the page rendered #03050a, a visible seam on
  every launch of the installed app. This holds them together.
*/
function cssBackground(): string {
  const match = /--bg:\s*(#[0-9a-fA-F]{6})/.exec(read('app/weir.css'));
  if (match === null) throw new Error('--bg is not declared in app/weir.css');
  return match[1]!.toLowerCase();
}

function viewportThemeColor(): string {
  const match = /themeColor:\s*'(#[0-9a-fA-F]{6})'/.exec(read('app/layout.tsx'));
  if (match === null) throw new Error('themeColor is not declared in app/layout.tsx');
  return match[1]!.toLowerCase();
}

describe('the installed app paints the same colour as the page', () => {
  it('names one colour in the manifest, the viewport and the stylesheet', () => {
    const bg = cssBackground();
    expect(manifest.theme_color.toLowerCase()).toBe(bg);
    expect(manifest.background_color.toLowerCase()).toBe(bg);
    expect(viewportThemeColor()).toBe(bg);
  });

  it('does not promise standalone without a service worker to back it', () => {
    if (manifest.display !== 'standalone') return;
    expect(read('public/sw.js').length).toBeGreaterThan(0);
    expect(read('app/layout.tsx')).toContain('serviceWorker.register("/sw.js")');
  });
});
