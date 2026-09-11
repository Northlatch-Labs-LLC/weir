// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
import { NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import { isSuiId } from '@/lib/db';
import { createClient, readContentPrice, readCreatorVault } from '@projectx-social/sdk';
import { siteConfig } from '@/lib/chain';
import { machineContentKey } from '@/lib/machine-pricing';
import { machineBodyState } from '@/lib/content';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const limited = rateLimit(request, 'read');
  if (limited !== null) return limited;

  const url = new URL(request.url);
  const vaultId = url.searchParams.get('vaultId');
  const contentKey = url.searchParams.get('contentKey');
  if (vaultId === null || contentKey === null || contentKey.trim() === '') {
    return NextResponse.json({ error: 'vaultId and contentKey are required' }, { status: 400 });
  }
  if (!isSuiId(vaultId)) {
    return NextResponse.json(
      { error: 'vaultId must be 0x followed by hex digits' },
      { status: 400 },
    );
  }

  const machineKey = machineContentKey(contentKey);
  if (!machineKey.ok) {
    return NextResponse.json(
      { error: machineKey.failure.detail, kind: 'reserved' },
      { status: 400 },
    );
  }

  const config = siteConfig();
  if (!config.ok) return NextResponse.json({ error: config.failure.detail }, { status: 503 });

  const client = createClient(config.value);

  const vault = await readCreatorVault(client, vaultId);
  if (!vault.ok) {
    return NextResponse.json(
      { error: vault.failure.detail, kind: vault.failure.kind },
      { status: 503 },
    );
  }

  const price = await readContentPrice(client, vault.value.contentPricesTableId, contentKey.trim());
  if (!price.ok) {
    return NextResponse.json(
      { error: price.failure.detail, kind: price.failure.kind },
      { status: 503 },
    );
  }

  const machinePrice = await readContentPrice(
    client,
    vault.value.contentPricesTableId,
    machineKey.value,
  );
  const machine = machinePrice.ok
    ? {
        contentKey: machineKey.value,
        state: machinePrice.value === null ? ('unpriced' as const) : ('priced' as const),
        price: machinePrice.value?.toString() ?? null,
      }
    : { contentKey: machineKey.value, state: 'unreadable' as const, price: null };

  const machineBody = await machineBodyState(vaultId, contentKey.trim());

  return NextResponse.json({
    priced: price.value !== null,
    price: price.value?.toString() ?? null,
    machine,
    machineBody,
  });
}
