// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import { NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import { fold, type PublishedKey, type Reading } from '@projectx-social/sdk';
import { readKeysOf, toBase64 } from '@/lib/keys';

export const dynamic = 'force-dynamic';

const SUI_ADDRESS = /^(0x)?[0-9a-fA-F]{1,64}$/;

const MAX_ADDRESSES = 20;

export async function GET(request: Request) {
  const limited = rateLimit(request, 'read');
  if (limited !== null) return limited;

  const raw = new URL(request.url).searchParams.get('addresses');
  if (raw === null || raw.trim() === '') {
    return NextResponse.json({ error: 'addresses is required' }, { status: 400 });
  }

  const addresses = raw.split(',').map((a) => a.trim()).filter((a) => a !== '');
  if (addresses.length > MAX_ADDRESSES) {
    return NextResponse.json(
      { error: `at most ${MAX_ADDRESSES} addresses per request` },
      { status: 400 },
    );
  }

  const notAnAddress = addresses.find((a) => !SUI_ADDRESS.test(a));
  if (notAnAddress !== undefined) {
    return NextResponse.json({ error: `${notAnAddress} is not a Sui address` }, { status: 400 });
  }

  const readings = await readKeysOf(addresses);

  const keys: Record<
    string,
    { key: string; version: string; updatedAtMs: string } | { key: null } | { error: string; kind: string }
  > = {};

  for (const [address, reading] of readings) {
    keys[address.toLowerCase()] = fold<
      PublishedKey | null,
      { key: string; version: string; updatedAtMs: string } | { key: null } | { error: string; kind: string }
    >(
      reading as Reading<PublishedKey | null>,
      (published) =>
        published === null
          ? { key: null }
          : {
              key: toBase64(published.x25519Public),
              version: published.version.toString(),
              updatedAtMs: published.updatedAtMs.toString(),
            },
      (failure) => ({ error: failure.detail, kind: failure.kind }),
    );
  }

  return NextResponse.json({ keys });
}
