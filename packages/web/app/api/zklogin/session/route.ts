// Built-by: @projectx.sui · Co-authored-by: Claude
import { NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import { createClient, readCurrentEpoch } from '@projectx-social/sdk';
import { siteConfig } from '@/lib/chain';
import { maxEpochFrom } from '@/lib/zklogin';
import { proverReachable, zkLoginConfig } from '@/lib/zklogin-server';

export const dynamic = 'force-dynamic';

/**
 * Everything the browser needs to begin a sign-in, in one call.
 *
 * The browser holds no configuration of its own — no client id compiled into the bundle, no RPC
 * endpoint, no prover URL. It asks for what it needs at the moment it needs it, which is the same
 * stance the rest of this application takes: `lib/chain.ts` is `server-only` for exactly this
 * reason, and shipping a `NEXT_PUBLIC_` variable here would have quietly reversed that decision
 * for the one feature most people will use.
 *
 * `maxEpoch` comes from a live chain read rather than a clock. Epochs do not advance on a fixed
 * schedule, so any locally-computed guess is wrong in one of two directions: a session that dies
 * early, or a session offered as valid that the network will refuse.
 *
 * ## An unconfigured deployment is not a broken one
 */
export async function GET(request: Request) {
  const limited = rateLimit(request, 'read');
  if (limited !== null) return limited;

  // The network is answered before anything zkLogin-specific, because the wallet path needs it
  // too — a wallet is asked to sign for `sui:<network>`, and a literal there would let a wallet
  // pointed at testnet sign a mainnet transaction shape without either side objecting.
  const site = siteConfig();
  if (!site.ok) {
    return NextResponse.json(
      { error: site.failure.detail, kind: site.failure.kind },
      { status: 503 },
    );
  }
  const network = site.value.network;

  const zk = zkLoginConfig();
  if (!zk.ok) {
    /*
      The reason is stated in general terms rather than echoed.
    */
    console.warn(`zkLogin unavailable: ${zk.failure.kind} — ${zk.failure.detail}`);
    return NextResponse.json({
      network,
      available: false,
      reason: 'Signing in with Google is not enabled on this deployment.',
    });
  }

  /*
    The prover is asked whether it is there before the button is offered.

    Configuration proves the URL is https and a key is set; it cannot prove the machine exists. This
    deployment has been in exactly that state before — see the off switch in `zkLoginConfig`: the
    button was live and every press ended at a host that had been torn down, after the round trip to
    Google, with the identity token already spent. `available` means "this will work" now.

    A prover that is gone is reported the same calm way as a deployment with no zkLogin at all: the
    Google button is not offered and the wallet paths stay. The reason is logged for whoever runs
    this, not printed for the reader — "the proving service is down" is our problem, not theirs.
  */
  const prover = await proverReachable(zk.value);
  if (!prover.ok) {
    console.warn(`zkLogin unavailable: ${prover.failure.kind} — ${prover.failure.detail}`);
    return NextResponse.json({
      network,
      available: false,
      reason: 'Signing in with Google is not available right now.',
    });
  }

  const epoch = await readCurrentEpoch(createClient(site.value));
  // A sign-in cannot be started without this. Offering the button anyway and failing after the
  // round trip to Google would burn the user's time and leave them on a callback page explaining
  // a problem that was known before they left.
  if (!epoch.ok) {
    return NextResponse.json(
      { error: epoch.failure.detail, kind: epoch.failure.kind },
      { status: 503 },
    );
  }

  const maxEpoch = maxEpochFrom(epoch.value);
  if (!maxEpoch.ok) {
    return NextResponse.json(
      { error: maxEpoch.failure.detail, kind: maxEpoch.failure.kind },
      { status: 503 },
    );
  }

  return NextResponse.json({
    network,
    available: true,
    googleClientId: zk.value.googleClientId,
    redirectUri: zk.value.redirectUri,
    currentEpoch: epoch.value.toString(),
    maxEpoch: maxEpoch.value,
  });
}
