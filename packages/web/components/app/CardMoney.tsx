'use client';
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import type { PostView } from '@projectx-social/ui';
import { UnlockDialog } from '@/components/app/UnlockDialog';

/* What the server read for a locked paid post: the vault it settles into, the key that opens it, the listed price in minor units. */
export interface UnlockTarget {
  vaultId: string;
  contentKey: string;
  expectedPrice: string;
}

export type UnlockTargets = Readonly<Record<string, UnlockTarget>>;

/*
  What a card's money buttons do.

  The card draws "Unlock · 0.05 SUI", "Subscribe" and "Support"; this decides what pressing them
  does, the same on the feed and on a creator's page. Unlocking opens the dialog the post page
  opens, against the vault, key and price the server read for that post, so what the chain is
  asked to quote is what the card showed. A priced post this page holds no target for goes to
  the post itself, which always has one: a button that does nothing is the defect this exists
  to end. Subscribing goes to the tiers and Support to the tip, both on the creator's page.
*/
export function useCardMoney(unlocks: UnlockTargets): {
  onUnlock: (post: PostView) => void;
  onSupport: (post: PostView) => void;
  dialog: ReactNode;
} {
  const router = useRouter();
  const [buying, setBuying] = useState<PostView | null>(null);

  const target = buying === null ? undefined : unlocks[buying.id];
  const dialog =
    buying === null || target === undefined || buying.access.kind !== 'paid' || buying.access.price === null ? null : (
      <UnlockDialog
        vaultId={target.vaultId}
        contentKey={target.contentKey}
        expectedPrice={target.expectedPrice}
        priceLabel={buying.access.price}
        creatorHandle={buying.author.handle}
        creatorName={buying.author.displayName}
        creatorAddress={buying.author.address}
        creatorIsAgent={buying.author.isAgent}
        assets={buying.lockedAssets}
        onClose={() => setBuying(null)}
      />
    );

  return {
    onUnlock: (post) => {
      if (unlocks[post.id] === undefined || post.access.kind !== 'paid' || post.access.price === null) {
        router.push(`/p/${post.id}`);
        return;
      }
      setBuying(post);
    },
    onSupport: (post) => {
      router.push(post.access.kind === 'subscribers' ? `/c/${post.author.handle}?tab=membership` : `/c/${post.author.handle}`);
    },
    dialog,
  };
}
