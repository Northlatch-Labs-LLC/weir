// Built-by: @projectx.sui /|\ · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
import 'server-only';

/**
 * The data half of `/agents`.
 *
 * # One source, and it is the manifest
 *
 * Everything here comes from `agentManifest(origin)` — the same function that builds the document
 * served at `/.well-known/weir-agent.json`. Not a second read of the chain, not a copy of the ids,
 * not a constant. If this page and that document ever disagreed, an operator would have been shown
 * one set of facts and their agent would have fetched another, and the disagreement would be
 * invisible to both of us. There is one call and it is shared.
 *
 * # A value that could not be read arrives as null with a reason
 *
 * The manifest already models this: `unavailable`, `platformUnavailable`, `signerUnavailable` and
 * friends are the sibling of every optional section. This module carries that distinction through
 * to the component rather than flattening it — no `?? 0`, no `|| '—'`, no default that would make
 * a failed chain read look like a measured fact. `Agents.tsx` renders a null as "not measured"
 * with the reason underneath.
 *
 * # Money is formatted by string manipulation, never by float
 *
 * `creationFeeMist` is a decimal string of the smallest unit. It is converted to a display figure
 * by inserting a decimal point at the coin's own decimal position — read from the manifest, never
 * assumed — because `Number(mist) / 1e9` loses precision above 2^53, and a creation fee is exactly
 * the kind of figure somebody sizes a decision on.
 */

import { headers } from 'next/headers';
import { agentManifest, AGENT_MANIFEST_DNS_ANCHOR, AGENT_MANIFEST_PATH } from '@/lib/agent-manifest';
import { DesignAgents, type AgentFact, type AgentEndpointRow } from '@/components/design/Agents';

/** Present when we have it, and a stated reason when we do not. Never a default. */
const measured = (value: string | null | undefined, why: string): AgentFact =>
  value === null || value === undefined || value === ''
    ? { value: null, unavailable: why }
    : { value, unavailable: null };

/**
 * A minor-unit decimal string rendered at a given scale, by moving the point.
 *
 * No `Number`, no `parseFloat`, no division. `29000000000` at nine decimals is `29`, and it stays
 * exact whatever the magnitude. Returns null on anything that is not a run of digits rather than
 * guessing, because a fee we cannot parse is a fee we have not measured.
 */
export function formatMinorUnits(minor: string, decimals: number): string | null {
  if (!/^\d+$/.test(minor)) return null;
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 38) return null;
  const padded = minor.padStart(decimals + 1, '0');
  const whole = padded.slice(0, padded.length - decimals);
  const frac = decimals === 0 ? '' : padded.slice(padded.length - decimals).replace(/0+$/, '');
  return frac === '' ? whole : `${whole}.${frac}`;
}

/**
 * Basis points as a percentage string, by string arithmetic on an integer.
 *
 * 290 bps is 2.9%. Done as integer maths against the denominator the manifest publishes rather
 * than `bps / 100`, so a denominator change in the contract cannot silently mis-scale the figure
 * shown to an operator.
 */
export function formatBps(bps: string, denominator: string): string | null {
  if (!/^\d+$/.test(bps) || !/^\d+$/.test(denominator)) return null;
  const d = BigInt(denominator);
  if (d === 0n) return null;
  // percent = bps * 100 / denominator, kept to two decimal places without floating point.
  const hundredths = (BigInt(bps) * 10000n) / d;
  const whole = hundredths / 100n;
  const frac = (hundredths % 100n).toString().padStart(2, '0').replace(/0+$/, '');
  return frac === '' ? `${whole}%` : `${whole}.${frac}%`;
}

/** The origin this request arrived on, so the manifest names the host the reader is actually on. */
async function originOfRequest(): Promise<string> {
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host');
  if (host === null || host === '') return '';
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}

export async function AgentsData() {
  const manifest = await agentManifest(await originOfRequest());

  const chain = manifest.chain;
  const money = manifest.money;
  const platform = money?.platform ?? null;

  /*
    Why each unavailable string is phrased where it is: the manifest's own `*Unavailable` field is
    preferred whenever it exists, because it was written by the code that failed and knows which
    of "not configured" and "could not read" applies. The fallbacks below only fire when a whole
    section is absent, and they say that rather than inventing a cause.
  */
  const chainWhy =
    manifest.unavailable ?? 'this deployment did not publish its chain configuration';
  const moneyWhy =
    money?.platformUnavailable ??
    manifest.unavailable ??
    'the platform object was not read on this request';

  const suiDecimals = money?.decimals?.['sui'];
  const vaultPrice =
    platform === null || suiDecimals === undefined
      ? { value: null, unavailable: moneyWhy }
      : measured(
          (() => {
            const formatted = formatMinorUnits(platform.creationFeeMist, suiDecimals);
            return formatted === null ? null : `${formatted} SUI`;
          })(),
          `the creation fee was read as ${JSON.stringify(platform.creationFeeMist)}, which is not a whole number of the smallest unit`,
        );

  const fee =
    platform === null || money === null
      ? { value: null, unavailable: moneyWhy }
      : measured(
          formatBps(platform.feeBps, money.bpsDenominator),
          `the fee was read as ${JSON.stringify(platform.feeBps)} against a denominator of ${JSON.stringify(money.bpsDenominator)}, which does not divide`,
        );

  const endpoints: AgentEndpointRow[] = manifest.endpoints.map((e) => ({
    path: e.path,
    methods: e.methods,
    proof: e.proof,
    purpose: e.purpose,
  }));

  /*
    Statements live under `authentication`, not at the top level. De-duplicated and sorted so the
    list reads as a set of capabilities rather than a call log — several kinds publish more than
    one variant, and an operator counting rows would otherwise over-count what an agent can do.
  */
  const statementKinds: string[] = [
    ...new Set(manifest.authentication.statements.map((s): string => s.kind)),
  ].sort();

  return (
    <DesignAgents
      network={measured(chain?.network, chainWhy)}
      originalPackageId={measured(chain?.originalPackageId, chainWhy)}
      latestPackageId={measured(chain?.latestPackageId, chainWhy)}
      platformId={measured(chain?.platformId, chainWhy)}
      registryId={measured(chain?.registryId, chainWhy)}
      fee={fee}
      vaultPrice={vaultPrice}
      accountsOpen={
        platform === null
          ? { value: null, unavailable: moneyWhy }
          : {
              value: platform.creationPaused ? 'paused' : 'open',
              unavailable: null,
            }
      }
      manifestPath={AGENT_MANIFEST_PATH}
      manifestSigned={manifest.integrity.signer !== null}
      manifestUnsigned={manifest.integrity.signerUnavailable}
      dnsAnchor={AGENT_MANIFEST_DNS_ANCHOR}
      endpoints={endpoints}
      statementKinds={statementKinds}
      wholeDocumentUnavailable={manifest.unavailable}
    />
  );
}
