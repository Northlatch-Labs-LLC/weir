// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
/**
 * What the composer promises about storage must be what the storage actually does.
 *
 * # The defect this pins
 *
 * `studio/upload` chooses the lease from the access level:
 *
 *     tier: gated ? 'durable' : 'ephemeral'
 *
 * so a **public** post's image is bought for one epoch — fourteen days — and a **paid** post's for
 * fifty-three, a little over two years. The composer told the creator the opposite:
 *
 *     public — "readable by anyone from any Walrus aggregator, permanently and without this
 *     platform"
 *
 * Permanence was promised on precisely the tier with the shortest life, and the rest of the
 * sentence is true, which is what made it convincing. A creator reading it had no way to learn
 * that their free post's image would be deleted in a fortnight; nothing else in the interface says
 * so, and the post goes on rendering after the blob is gone, with only the image failing.
 *
 * # Why the durations are asserted rather than described
 *
 * The composer runs in the browser and `publisher-token.ts` is `server-only`, so the two cannot
 * share a value through an import — which is how the copy drifted from the code in the first
 * place. `lib/storage-retention.ts` exists to be the one place both may read, and these tests exist
 * so that changing the lease without changing the sentence fails here.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EPOCH_DAYS, TIER_EPOCHS, retentionDays } from '../lib/storage-retention';
import { MAX_EPOCHS } from '../lib/walrus';

const root = join(import.meta.dirname, '..');
const composer = readFileSync(join(root, 'components/StudioComposer.tsx'), 'utf8');
const upload = readFileSync(join(root, 'app/api/studio/upload/route.ts'), 'utf8');

describe('the lease the code buys', () => {
  it('is one epoch for free posts and the Walrus maximum for paid ones', () => {
    // Pinned because every sentence asserted below is only true while this holds.
    expect(TIER_EPOCHS.ephemeral).toBe(1);
    expect(TIER_EPOCHS.durable).toBe(MAX_EPOCHS);
  });

  it('is still chosen by whether the post is gated', () => {
    // If this stops being the rule, the composer's per-access copy answers the wrong question.
    expect(upload).toContain("gated ? 'durable' : 'ephemeral'");
  });

  it('converts to the days a person can act on', () => {
    expect(EPOCH_DAYS).toBe(14);
    expect(retentionDays('ephemeral')).toBe(14);
    expect(retentionDays('durable')).toBe(742);
  });
});

describe('what the composer tells a creator before they publish', () => {
  it('never promises a stored image is permanent', () => {
    /*
      The exact regression, asserted across the whole file rather than inside one branch — the
      branches were reordered while fixing this, and a test that depended on their order would have
      passed by reading an empty slice.

      "not permanence" is the one allowed use: the note shown after storing says storage *is* a
      lease and is not permanence, which is the opposite claim.
    */
    for (const match of composer.matchAll(/[^.]*permanen\w*[^.]*/gi)) {
      expect(match[0]).toMatch(/not permanence/i);
    }
  });

  it('takes both durations from the shared source rather than a copied number', () => {
    /*
      The heart of it. A literal "14 days" typed into the JSX would satisfy a reader and drift the
      moment the tier changed — which is precisely how "permanently" survived next to a one-epoch
      lease. Requiring the call means the sentence cannot disagree with the purchase.
    */
    expect(composer).toContain("retentionDays('ephemeral')");
    expect(composer).toContain("retentionDays('durable')");
    expect(composer).toContain("from '@/lib/storage-retention'");
  });

  it('reaches the creator before they publish, not only after', () => {
    // The copy sits in the block rendered as soon as a file is chosen, alongside the access level —
    // the moment the decision is still changeable. The post-upload note is a confirmation, not a
    // warning.
    const beforePublish = composer.slice(
      composer.indexOf('image !== null &&'),
      composer.indexOf("media.name === 'storing'"),
    );
    expect(beforePublish).toContain("retentionDays('ephemeral')");
  });

  it('says the free image is deleted, not merely that a lease exists', () => {
    /*
      "Storage is a lease" is true and abstract. What a creator needs to know is that the picture
      goes away — so the word has to appear where they choose the access level, not only in the
      confirmation shown after publishing, which is too late to change the decision.
    */
    expect(composer).toMatch(/deleted|removed|disappears/i);
  });
});
