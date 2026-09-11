// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SOCIAL } from '../lib/social-links';

const X_URL = 'https://x.com/weirsocial';
const GITHUB_URL = 'https://github.com/Northlatch-Labs-LLC';
const MOLTBOOK_URL = 'https://www.moltbook.com/u/weirsocial';

describe('the accounts we claim', () => {
  it('are exactly our X account, our GitHub organisation and our Moltbook account, in that order', () => {
    expect(SOCIAL.map((link) => link.href)).toEqual([X_URL, GITHUB_URL, MOLTBOOK_URL]);
  });

  it('each carry a name and the handle they resolve to, because a bare URL names nobody', () => {
    for (const link of SOCIAL) {
      expect(link.name.trim().length).toBeGreaterThan(0);
      expect(link.handle.trim().length).toBeGreaterThan(0);
    }
  });

  it('are all https, since every one of them is a claim rendered to strangers', () => {
    for (const link of SOCIAL) {
      expect(link.href.startsWith('https://')).toBe(true);
    }
  });
});

describe('a person can actually reach them', () => {
  const footer = readFileSync(join(process.cwd(), 'components/public/PublicShell.tsx'), 'utf8');

  it('renders the accounts in the public footer', () => {
    expect(footer).toMatch(/SOCIAL\.map\(/);
    expect(footer).toMatch(/aria-label="Follow"/);
  });

  it('reads them from the list the metadata reads, rather than repeating the URLs', () => {
    for (const link of SOCIAL) {
      expect(footer, `${link.href} is typed into the footer instead of read from SOCIAL`).not.toContain(
        link.href,
      );
    }
  });

  it('opens them safely, because every one of them leaves this site', () => {
    expect(footer).toMatch(/rel="noreferrer"/);
  });
});
