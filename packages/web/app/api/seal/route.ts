// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
import { NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import { siteConfig } from '@/lib/chain';
import { sealSettings } from '@/lib/seal';

/**
 * What a reader's browser needs to open media this server cannot.
 *
 * # Why the browser asks instead of being told
 *
 * `SealedMedia` renders inside `PostCard`, which renders inside `Creator` and `Home` — both client
 * components. So the post card is in the browser bundle regardless of what it declares, and it can
 * reach neither `siteConfig()` nor any `server-only` module to hand the settings down as props.
 *
 * That leaves the two options this codebase has already chosen between. `app/api/deployment` states
 * the decision plainly: the browser holds no configuration of its own, there is no `NEXT_PUBLIC_`
 * variable in this codebase, and it "is not going to be the first" — so the browser asks, exactly
 * as sign-in asks `/api/zklogin/session`. This is that endpoint for threshold decryption.
 *
 * # Everything returned here is public, and one line is a real cost
 *
 * The package and object ids are on chain. The key servers are named by object id — also on chain,
 * which is how `verifyKeyServers` checks them — and their aggregator URLs are the addresses of
 * public HTTP services.
 *
 * `grpcUrl` is the exception worth naming rather than burying. `lib/chain.ts` holds that "the
 * browser never holds a chain client, never picks an RPC endpoint, and cannot be pointed at a
 * different one by a query parameter", and returning it here relaxes the first two clauses for the
 * readers who decrypt. `lib/seal-open.ts` already accepted that cost in writing, and the third
 * clause — the one that carries the security weight — still holds: the endpoint arrives from this
 * server's validated configuration and cannot be chosen by a URL. A reader who edits it in their
 * own tab attacks only their own decryption.
 *
 * # What is deliberately withheld
 *
 * `apiKeyName` and `apiKey`. Every permissioned key server has them, `lib/seal.ts` sends them from
 * the server, and they are the one part of a `SealKeyServer` that is a credential rather than an
 * address. The mapping below names the three fields it publishes instead of spreading the object,
 * so a field added to that type later cannot reach a reader's tab by inheritance.
 *
 * # Unconfigured is a state, not an error
 *
 * `keyServers: []` with HTTP 200, matching `/api/deployment`'s `packageId: null`. A deployment with
 * no committee configured has not failed; it simply cannot open sealed media, and the component is
 * built to say so. A 500 would make a correct absence look like a broken server, and would do it on
 * every post card carrying a picture.
 */

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const limited = rateLimit(request, 'read');
  if (limited !== null) return limited;

  const config = siteConfig();
  if (!config.ok) {
    return NextResponse.json({ config: null, keyServers: [] });
  }

  const seal = sealSettings();

  return NextResponse.json({
    /*
      The six fields `createClient` and `SessionKey.create` need, listed rather than spread.

      `ProjectXSocialConfig` holds nothing secret today. Enumerating them anyway is the same
      discipline as the key server mapping below: the guarantee should come from this file, not from
      a type in another package continuing to contain only public things.
    */
    config: {
      network: config.value.network,
      grpcUrl: config.value.grpcUrl,
      packageId: config.value.packageId,
      latestPackageId: config.value.latestPackageId,
      platformId: config.value.platformId,
      registryId: config.value.registryId,
    },
    keyServers: seal.ok
      ? seal.value.keyServers.map((server) => ({
          objectId: server.objectId,
          weight: server.weight,
          // Spread rather than assigned, as everywhere else this shape is built: the SDK tells a
          // committee-mode server from an independent one by whether the key is *present*, and an
          // explicit `undefined` counts as present.
          ...(server.aggregatorUrl === undefined ? {} : { aggregatorUrl: server.aggregatorUrl }),
        }))
      : [],
  });
}
