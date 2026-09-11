// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EPOCH_DAYS, TIER_EPOCHS, retentionDays, tierForAccess } from '../lib/storage-retention';
import { MAX_EPOCHS } from '../lib/walrus';

const root = join(import.meta.dirname, '..');
const composer = readFileSync(join(root, 'components/StudioComposer.tsx'), 'utf8');
const upload = readFileSync(join(root, 'app/api/studio/upload/route.ts'), 'utf8');

describe('the lease the code buys', () => {
  it('is one epoch for free posts and the Walrus maximum for paid ones', () => {
    expect(TIER_EPOCHS.ephemeral).toBe(1);
    expect(TIER_EPOCHS.durable).toBe(MAX_EPOCHS);
  });

  it('is chosen from the post\u2019s access kind, never from whether the asset is encrypted', () => {
    /*
      This asserted the string `gated !== null ? 'durable' : 'ephemeral'` was present in the upload
      route. That expression had already been replaced; what the assertion actually matched was a
      comment saying so — so the test passed by finding a note about the defect it was written to
      prevent, and would have gone on passing with the route rewritten around it.

      Deriving the lease from `gated` asks whether the asset is encrypted. That agrees with the
      access kind today by coincidence, not construction, and it is how the route and
      `tierForAccess` came to disagree about subscribers while both looked correct. So the mapping
      is asserted where it lives, and the route is asserted to call it rather than re-derive.
    */
    expect(tierForAccess('public')).toBe('ephemeral');
    expect(tierForAccess('subscribers')).toBe('durable');
    expect(tierForAccess('paid')).toBe('durable');
    expect(upload).toContain('tier: tierForAccess(post.access.kind)');
    expect(upload).not.toContain("gated !== null ? 'durable'");
  });

  it('converts to the days a person can act on', () => {
    expect(EPOCH_DAYS).toBe(14);
    expect(retentionDays('ephemeral')).toBe(14);
    expect(retentionDays('durable')).toBe(742);
  });
});

describe('what the composer tells a creator before they publish', () => {
  it('never promises a stored image is permanent', () => {
    for (const match of composer.matchAll(/[^.]*permanen\w*[^.]*/gi)) {
      expect(match[0]).toMatch(/not permanence/i);
    }
  });

  it('takes both durations from the shared source rather than a copied number', () => {
    expect(composer).toContain("retentionDays('ephemeral')");
    expect(composer).toContain("retentionDays('durable')");
    expect(composer).toContain("from '@/lib/storage-retention'");
  });

  it('reaches the creator before they publish, not only after', () => {
    const beforePublish = composer.slice(
      composer.indexOf('image !== null &&'),
      composer.indexOf("media.name === 'storing'"),
    );
    expect(beforePublish).toContain("retentionDays('ephemeral')");
  });

  it('says the free image is deleted, not merely that a lease exists', () => {
    expect(composer).toMatch(/deleted|removed|disappears/i);
  });
});

describe('the mapping from access to lease', () => {
  it('gives an open post the short lease', () => {
    expect(tierForAccess('public')).toBe('ephemeral');
  });

  for (const access of ['subscribers', 'paid'] as const) {
    it(`gives ${access} media the durable lease`, () => {
      expect(tierForAccess(access)).toBe('durable');
    });
  }

  it('the durable lease is the one that outlives an entitlement', () => {
    expect(TIER_EPOCHS.durable).toBeGreaterThan(TIER_EPOCHS.ephemeral);
    expect(TIER_EPOCHS.ephemeral).toBe(1);
  });
});

describe('the upload route uses the mapping rather than its own', () => {
  const route = readFileSync(
    join(process.cwd(), 'app', 'api', 'studio', 'upload', 'route.ts'),
    'utf8',
  )
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ');

  it('calls tierForAccess', () => {
    expect(route).toMatch(/tier:\s*tierForAccess\(/);
  });

  it('no longer decides a lease by asking whether the asset is encrypted', () => {
    expect(route).not.toMatch(/gated\s*!==\s*null\s*\?\s*'durable'/);
  });
});
