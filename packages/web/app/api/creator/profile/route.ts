// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import { NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import { createClient, fold, readCreatorVault } from '@projectx-social/sdk';
import { siteConfig } from '@/lib/chain';
import { findProfile, findProfileByVault, upsertProfile } from '@/lib/content';
import { accountHandle } from '@/lib/accounts';
import { verifyAction } from '@/lib/identity';
import { coinTypeOf } from '@/lib/creator-setup';

export const MAX_DISPLAY_NAME_LENGTH = 60;
export const MAX_BIO_LENGTH = 280;

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const limited = rateLimit(request, 'write');
  if (limited !== null) return limited;

  const b = (await request.json()) as {
    owner?: string; vaultId?: string; coinType?: string; displayName?: string; bio?: string;
    signature?: string; timestampMs?: number;
  };
  if (!b.owner || !b.vaultId || !b.coinType) {
    return NextResponse.json({ error: 'owner, vaultId and coinType are required' }, { status: 400 });
  }

  const config = siteConfig();
  if (!config.ok) {
    return NextResponse.json({ error: config.failure.detail }, { status: 503 });
  }

  const client = createClient(config.value);
  const vault = await readCreatorVault(client, b.vaultId);
  if (!vault.ok) {
    return NextResponse.json(
      { error: `the vault is still being read from the chain: ${vault.failure.detail}` },
      { status: 424 },
    );
  }
  const tooLong =
    (b.displayName ?? '').length > MAX_DISPLAY_NAME_LENGTH
      ? `displayName exceeds ${MAX_DISPLAY_NAME_LENGTH} characters`
      : (b.bio ?? '').length > MAX_BIO_LENGTH
        ? `bio exceeds ${MAX_BIO_LENGTH} characters`
        : null;
  if (tooLong !== null) return NextResponse.json({ error: tooLong }, { status: 400 });

  const proof = await verifyAction({
    origin: new URL(request.url).origin,
    address: b.owner,
    signature: b.signature ?? '',
    timestampMs: b.timestampMs ?? 0,
    action: {
      kind: 'name-vault',
      vaultId: b.vaultId,
      coinType: b.coinType,
      name: b.displayName ?? '',
      bio: b.bio ?? '',
    },
  });
  if (!proof.ok) {
    return NextResponse.json({ error: proof.failure.detail }, { status: 401 });
  }

  if (vault.value.owner.toLowerCase() !== b.owner.toLowerCase()) {
    return NextResponse.json(
      { error: 'that vault belongs to a different address' },
      { status: 403 },
    );
  }

  const onChainCoin = await coinTypeOf(client, b.vaultId);
  if (onChainCoin === null) {
    return NextResponse.json({ error: 'the vault coin type is still being read from the chain' }, { status: 424 });
  }
  if (normaliseCoinType(onChainCoin) !== normaliseCoinType(b.coinType)) {
    return NextResponse.json(
      { error: `coinType does not match the vault: the vault is denominated in ${onChainCoin}` },
      { status: 400 },
    );
  }

  const handle = await accountHandle(b.owner);
  if (!handle.ok) {
    return NextResponse.json({ error: handle.failure.detail }, { status: 424 });
  }
  if (handle.value === null) {
    return NextResponse.json(
      { error: 'this address holds no account, so it has no handle to publish under' },
      { status: 400 },
    );
  }

  const claimed = await findProfileByVault(b.vaultId);
  if (claimed !== null) {
    await upsertProfile({
      ...claimed,
      owner: b.owner,
      displayName: b.displayName ?? claimed.handle,
      bio: b.bio ?? '',
      coinType: b.coinType,
    });
    return NextResponse.json({ handle: claimed.handle });
  }

  let slug = handle.value;
  const existing = await findProfile(slug);
  if (
    existing !== null &&
    existing.vaultId !== null &&
    existing.vaultId.toLowerCase() !== b.vaultId.toLowerCase()
  ) {
    slug = `${handle.value}-${b.vaultId.slice(2, 6)}`;
  }

  await upsertProfile({
    handle: slug,
    vaultId: b.vaultId,
    owner: b.owner,
    displayName: b.displayName ?? handle.value,
    bio: b.bio ?? '',
    coinType: b.coinType,
  });

  return NextResponse.json({ handle: slug });
}

function normaliseCoinType(coinType: string): string {
  const [pkg, ...rest] = coinType.trim().split('::');
  const hex = (pkg ?? '').replace(/^0x/i, '').padStart(64, '0').toLowerCase();
  return `0x${hex}::${rest.join('::')}`;
}
