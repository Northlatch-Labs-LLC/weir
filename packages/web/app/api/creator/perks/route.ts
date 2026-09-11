// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import { NextResponse } from 'next/server';
import { fold, MAX_HANDLE_LEN } from '@projectx-social/sdk';
import { rateLimit, sharedLimit } from '@/lib/rate-limit';
import { accountHandle } from '@/lib/accounts';
import { verifyAction } from '@/lib/identity';
import { listPerks, setPerks, setSupportersFirst, readSupportersFirst, validatePerks } from '@/lib/perks';
import { perksDigest } from '@/lib/perks-digest';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const limited = rateLimit(request, 'read');
  if (limited !== null) return limited;

  const shared = await sharedLimit(request, 'read');
  if (shared !== null) return shared;

  const handle = new URL(request.url).searchParams.get('handle');
  if (handle === null) return NextResponse.json({ error: 'handle is required' }, { status: 400 });
  if (handle.length > MAX_HANDLE_LEN) {
    return NextResponse.json({ error: 'that is not a handle' }, { status: 400 });
  }
  const [perks, supportersFirst] = await Promise.all([listPerks(handle), readSupportersFirst(handle)]);
  return NextResponse.json({
    perks: perks.map((p) => ({ thresholdUnits: p.thresholdUnits.toString(), title: p.title, detail: p.detail })),
    supportersFirst,
  });
}

export async function POST(request: Request) {
  const limited = rateLimit(request, 'write');
  if (limited !== null) return limited;

  const body = (await request.json()) as {
    address?: string;
    handle?: string;
    perks?: unknown;
    supportersFirst?: boolean;
    signature?: string;
    timestampMs?: number;
  };
  const address = body.address;
  const claimed = body.handle;
  if (!address || !claimed) {
    return NextResponse.json({ error: 'address and handle are required' }, { status: 400 });
  }

  const checked = validatePerks(body.perks ?? []);
  if (!checked.ok) return NextResponse.json({ error: checked.why }, { status: 400 });
  const supportersFirst = body.supportersFirst === true;

  const digest = await perksDigest(
    checked.perks.map((p) => ({
      thresholdUnits: p.thresholdUnits.toString(),
      title: p.title,
      detail: p.detail,
    })),
    supportersFirst,
  );

  const proof = await verifyAction({
    origin: new URL(request.url).origin,
    address,
    signature: body.signature ?? '',
    timestampMs: body.timestampMs ?? 0,
    action: { kind: 'set-perks', handle: claimed, perksSha256: digest, supportersFirst },
  });
  if (!proof.ok) return NextResponse.json({ error: proof.failure.detail }, { status: 401 });

  return fold<string | null, Promise<NextResponse>>(
    await accountHandle(address),
    async (handle) => {
      if (handle === null) {
        return NextResponse.json({ error: 'this address does not hold an account yet' }, { status: 409 });
      }
      if (handle !== claimed) {
        return NextResponse.json(
          { error: `this address holds @${handle}, not @${claimed}` },
          { status: 403 },
        );
      }
      await setPerks(handle, checked.perks);
      await setSupportersFirst(handle, supportersFirst);
      return NextResponse.json({ handle, perks: checked.perks.length, supportersFirst });
    },
    async (failure) => NextResponse.json({ error: failure.detail }, { status: 503 }),
  );
}
