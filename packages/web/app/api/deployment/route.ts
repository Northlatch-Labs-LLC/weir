// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
import { NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import { explorerUrl, siteConfig } from '@/lib/chain';

/**
 * Which deployment is this?
 *
 * # Why an endpoint for one line of footer
 *
 * The footer's last line is "Verify everything: <the package digest>". It was a hardcoded
 * placeholder — *"package digest — set at deploy"* — rendered in the alert colour, which is this
 * design's way of saying "not measured". It said that on every page of a deployment that has known
 * its own package id since publish. An invitation to verify, next to nothing to verify.
 *
 * The footer is a client component with fourteen call sites, so the id has to reach the browser
 * somehow. This application's stance on that is settled and stated in `app/api/zklogin/session`:
 * the browser holds no configuration of its own — no client id in the bundle, no RPC endpoint —
 * and shipping a `NEXT_PUBLIC_` variable "would have quietly reversed that decision". There is not
 * one in this codebase and this is not going to be the first.
 *
 * So the browser asks, exactly as it does for the sign-in configuration.
 *
 * # Everything here is already public
 *
 * A package id is on chain and in the deployment record; the explorer link is derived from it.
 * There is nothing to withhold — the whole point of the line is that a stranger can check us
 * without trusting us.
 *
 * # Unconfigured is a state, not an error
 *
 * `packageId: null` with HTTP 200. A deployment that has not been pointed at a chain should render
 * the footer's honest "not measured" state, which is what the design already draws. A 500 would
 * make a correctly-configured absence look like a broken server.
 */

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const limited = rateLimit(request, 'read');
  if (limited !== null) return limited;

  const config = siteConfig();
  if (!config.ok) {
    return NextResponse.json({
      packageId: null,
      explorer: null,
      latestPackageId: null,
      latestExplorer: null,
      network: null,
    });
  }

  /*
    Both ids, because naming one of them is a false invitation.

    This route used to return `packageId` alone, and the footer beside it says "Verify everything".
    `packageId` is the *original* publication — `packages/sdk/src/config.ts` states the rule
    directly: it is type identity, and "never for a call target: after an upgrade it names the old
    code, which does not contain modules added since".

    This deployment has been upgraded. The original holds six modules; the running package holds
    seven, and the seventh is `key_registry` — the module that decides who can decrypt a paid body.
    A reader who followed that single link went to a package where the code doing the most sensitive
    work in the product does not appear, and nothing on the page told them so. Verified from chain:
    the live registry's type is `0xa7fd1540…::key_registry::KeyRegistry`, namespaced to the upgrade,
    which is only possible if the module was born there.

    So both go out, and the footer labels which is which. A person checking us needs the executing
    package to read the code and the original to recognise the type tags on every object the product
    has ever created; neither one alone answers "verify everything".
  */
  return NextResponse.json({
    packageId: config.value.packageId,
    explorer: explorerUrl(config.value.packageId),
    latestPackageId: config.value.latestPackageId,
    latestExplorer: explorerUrl(config.value.latestPackageId),
    network: config.value.network ?? null,
  });
}
