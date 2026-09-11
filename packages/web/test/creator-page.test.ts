// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const PAGE = readFileSync(new URL('../app/c/[handle]/page.tsx', import.meta.url), 'utf8');

const CARD = (() => {
  const start = PAGE.indexOf('accountName=');
  if (start === -1) throw new Error('the support vault attribution was not found');
  const after = PAGE.indexOf('depositLine=', start);
  if (after === -1) throw new Error('the deposit line was not found');
  const end = PAGE.indexOf('tab={tab}', after);
  return PAGE.slice(start, end === -1 ? PAGE.length : end);
})();

describe('attributing the support vault', () => {
  it('names the account rather than this page', () => {
    expect(CARD).toContain('ownerName ?? shortId(profile.owner)');
  });

  it('never attributes the vault to the page it happens to be rendered on', () => {
    expect(CARD).not.toContain('profile.displayName');
  });

  it('tells the reader the vault is shared across that account’s pages', () => {
    expect(CARD).toMatch(/belongs to that account rather than to this page/i);
  });

  it('still finds the vault by owner, not by creator vault', () => {
    expect(PAGE).toContain('v.creator.toLowerCase() === profile.owner.toLowerCase()');
  });
});
