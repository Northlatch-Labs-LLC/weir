// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
import { NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import { fold } from '@projectx-social/sdk';
import { readCreatorSetup, type CreatorSetup } from '@/lib/creator-setup';
import { vaultCoinTypes } from '@/lib/chain';

export const dynamic = 'force-dynamic';

const SUI_ADDRESS = /^(0x)?[0-9a-fA-F]{1,64}$/;

/**
 * Where this address is in setting itself up as a creator.
 *
 * Four states, kept apart because each needs a different action: no account, no vault, a vault with
 * no tier, and ready. Collapsing any two sends half the people reading it to the wrong place.
 */
export async function GET(request: Request) {
  const limited = rateLimit(request, 'read');
  if (limited !== null) return limited;

  const owner = new URL(request.url).searchParams.get('owner');
  if (owner === null || !SUI_ADDRESS.test(owner)) {
    return NextResponse.json({ error: 'owner must be a Sui address' }, { status: 400 });
  }

  return fold<CreatorSetup, NextResponse>(
    await readCreatorSetup(owner),
    (setup) =>
      NextResponse.json(
        setup.stage === 'ready'
          ? {
              ...setup,
              vaultCoinTypes: vaultCoinTypes(),
              vaults: setup.vaults.map((v) => ({
                ...v,
                tiers: v.tiers.map((t) => ({ ...t, price: t.price.toString(), periodMs: t.periodMs.toString() })),
              })),
            }
          : { ...setup, vaultCoinTypes: vaultCoinTypes() },
      ),
    (failure) => NextResponse.json({ error: failure.detail, kind: failure.kind }, { status: 502 }),
  );
}
