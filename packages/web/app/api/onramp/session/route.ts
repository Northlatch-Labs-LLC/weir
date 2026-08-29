// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
import { NextResponse } from 'next/server';
import { fold } from '@projectx-social/sdk';
import { rateLimit, clientKey } from '@/lib/rate-limit';
import { createOnrampSession } from '@/lib/onramp';
import { readSiteMode } from '@/lib/site-mode';
import { passIsValid, passTokenFrom } from '@/lib/access-codes';
import { provenReaderFor } from '@/lib/read-session';
import { isSiteAdmin } from '@/lib/site-admin';

/**
 * Mint a card-purchase session.
 *
 * The whole reason this is a server route: the on-ramp's API secret must never reach a browser.
 * The client sends the address it wants funded and gets back a single-use URL that expires in five
 * minutes — it cannot mint sessions itself, and the URL it receives cannot be replayed by anyone
 * who copies it out of a history.
 *
 * Rate-limited as a write. Each session costs us nothing directly, but an unbounded endpoint that
 * mints third-party payment links on demand is somebody else's abuse surface, not just ours.
 *
 * The address is taken from the caller rather than derived here on purpose: the wallet that will
 * hold the funds is the visitor's own, and this server has no session identity for a person who
 * has not signed in yet — which is exactly the person who needs this door.
 */
export const dynamic = 'force-dynamic';

const ADDRESS = /^0x[0-9a-fA-F]{64}$/;

export async function POST(request: Request) {
  const limited = rateLimit(request, 'write');
  if (limited !== null) return limited;

  /*
    The front-door rule, applied to this door too. `proxy.ts` leaves the API open because every
    route on it resolves its own authority — and this one had none to resolve, which left the only
    payment-session mint on the site answering anonymous callers while the site itself was closed.
    While the waiting list is up, minting a session takes the same standing as walking the pages:
    a pass from a redeemed code, or the site administrator. When the door opens, this check
    disappears with it — the visitor who needs this route most has not signed in yet, and that
    design (see below) stands.
  */
  const mode = await readSiteMode();
  if (mode.waitlistMode) {
    let admitted = await passIsValid(passTokenFrom(request.headers.get('cookie')));
    if (!admitted) {
      const viewer = fold(
        await provenReaderFor(request),
        (value) => value,
        () => null,
      );
      admitted = await isSiteAdmin(viewer);
    }
    if (!admitted) {
      // The same words the closed site gives everywhere else, and no more: which check failed is
      // nobody's business but ours.
      return NextResponse.json({ error: 'the site is not open yet' }, { status: 403 });
    }
  }

  let body: { walletAddress?: unknown; asset?: unknown; fiatAmount?: unknown; fiatCurrency?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'that request was not JSON' }, { status: 400 });
  }

  const walletAddress = typeof body.walletAddress === 'string' ? body.walletAddress.trim() : '';
  if (!ADDRESS.test(walletAddress)) {
    // Refused rather than passed through: a malformed address sent to the on-ramp becomes a
    // purchase delivered nowhere, and there is no counterparty to appeal to afterwards.
    return NextResponse.json({ error: 'that is not a Sui address' }, { status: 400 });
  }

  const asset = body.asset === 'SUI' ? 'SUI' : 'USDC';
  const fiatAmount =
    typeof body.fiatAmount === 'number' && Number.isFinite(body.fiatAmount) && body.fiatAmount > 0
      ? body.fiatAmount
      : undefined;
  const fiatCurrency = typeof body.fiatCurrency === 'string' ? body.fiatCurrency : undefined;

  const session = await createOnrampSession({
    walletAddress,
    asset,
    ...(fiatAmount === undefined ? {} : { fiatAmount }),
    ...(fiatCurrency === undefined ? {} : { fiatCurrency }),
    referrerDomain: new URL(request.url).hostname,
    // The visitor's own address, resolved by the same hardened path the rate limiter trusts —
    // `cf-connecting-ip` only when we are actually behind Cloudflare, never a forgeable header.
    // "unattributed" means we could not establish it, and a fabricated IP is worse than none.
    ...(clientKey(request) === 'unattributed' ? {} : { userIp: clientKey(request) }),
    redirectUrl: new URL('/vault', request.url).toString(),
  });

  if (!session.ok) {
    // Distinguished deliberately: "this deployment has no card door" is a permanent, calm 503 the
    // page can explain, while "the on-ramp refused" is a 424 worth retrying. Collapsing them would
    // tell a visitor to try again forever on a deployment that was never configured.
    const status = session.reason === 'unconfigured' ? 503 : 424;
    const detail = session.reason === 'unconfigured' ? 'card payments are not configured here' : session.detail;
    return NextResponse.json({ error: detail, reason: session.reason }, { status });
  }

  return NextResponse.json({ widgetUrl: session.widgetUrl, environment: session.environment });
}
