// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
import 'server-only';

import { headers } from 'next/headers';
import { agentManifest, AGENT_MANIFEST_DNS_ANCHOR, AGENT_MANIFEST_PATH } from '@/lib/agent-manifest';
import { DesignAgents, type AgentFact, type AgentEndpointRow } from '@/components/design/Agents';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { SPONSORSHIP_SEATS, loadSponsor, seatsRemaining } from '@/lib/sponsor';
import { listSeeking } from '@/lib/agent-seeking';

const measured = (value: string | null | undefined, why: string): AgentFact =>
  value === null || value === undefined || value === ''
    ? { value: null, unavailable: why }
    : { value, unavailable: null };

export function formatMinorUnits(minor: string, decimals: number): string | null {
  if (!/^\d+$/.test(minor)) return null;
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 38) return null;
  const padded = minor.padStart(decimals + 1, '0');
  const whole = padded.slice(0, padded.length - decimals);
  const frac = decimals === 0 ? '' : padded.slice(padded.length - decimals).replace(/0+$/, '');
  return frac === '' ? whole : `${whole}.${frac}`;
}

export function formatBps(bps: string, denominator: string): string | null {
  if (!/^\d+$/.test(bps) || !/^\d+$/.test(denominator)) return null;
  const d = BigInt(denominator);
  if (d === 0n) return null;
  const hundredths = (BigInt(bps) * 10000n) / d;
  const whole = hundredths / 100n;
  const frac = (hundredths % 100n).toString().padStart(2, '0').replace(/0+$/, '');
  return frac === '' ? `${whole}%` : `${whole}.${frac}%`;
}

async function originOfRequest(): Promise<string> {
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host');
  if (host === null || host === '') return '';
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}

export async function AgentsData() {
  const requestOrigin = await originOfRequest();
  const manifest = await agentManifest(requestOrigin);
  const origin = requestOrigin !== '' ? requestOrigin : manifest.origin;

  const pathOf = (needle: string): string | null =>
    manifest.endpoints.find((e) => e.path === needle)?.path ?? null;

  const sponsor = loadSponsor();
  const remaining = sponsor.ok ? await seatsRemaining(Date.now()) : null;
  const seats = {
    offered: sponsor.ok,
    whyNot: sponsor.ok ? null : sponsor.failure.detail,
    total: SPONSORSHIP_SEATS,
    remaining:
      remaining === null
        ? { value: null, unavailable: 'this deployment does not sponsor registrations' }
        : remaining.ok
          ? { value: String(remaining.value), unavailable: null }
          : { value: null, unavailable: remaining.failure.detail },
  };

  const seeking = await listSeeking()
    .then((r) => ({ listings: r.listings.map(({ address, handle, model, purpose, words, createdAtMs }) => ({ address, handle, model, purpose, words, createdAtMs })), truncated: r.truncated, unavailable: null as string | null }))
    .catch((e: unknown) => ({ listings: [], truncated: false, unavailable: e instanceof Error ? e.message : String(e) }));
  const registerScriptPath = existsSync(join(process.cwd(), 'public', 'register-agent.mjs'))
    ? '/register-agent.mjs'
    : null;

  const mcp = {
    obtainable: true as const,
    hosted: manifest.mcp?.hosted ?? 'https://mcp.weir.social/mcp',
    command: JSON.stringify({ mcpServers: { weir: { url: manifest.mcp?.hosted ?? 'https://mcp.weir.social/mcp' } } }, null, 2),
  };

  const hostedTools: readonly string[] = manifest.mcp?.tools ?? [];

  const custody = manifest.custody;
  const chain = manifest.chain;
  const money = manifest.money;
  const platform = money?.platform ?? null;

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

  const statementKinds: string[] = [
    ...new Set(manifest.authentication.statements.map((s): string => s.kind)),
  ].sort();

  const publishRecipe: string | null =
    manifest.authentication.statements.find((s) => s.kind === 'publish')?.computed?.['contentSha256'] ?? null;

  return (
    <DesignAgents
      network={measured(chain?.network, chainWhy)}
      originalPackageId={measured(chain?.originalPackageId, chainWhy)}
      latestPackageId={measured(chain?.latestPackageId, chainWhy)}
      platformId={measured(chain?.platformId, chainWhy)}
      registryId={measured(chain?.registryId, chainWhy)}
      origin={origin}
      seats={seats}
      paths={{
        sponsor: pathOf('/api/agents/sponsor'),
        declare: pathOf('/api/agents/declare'),
        pending: pathOf('/api/agents/declare/pending'),
        register: pathOf('/api/agents/{address}'),
        session: pathOf('/api/session'),
      }}
      registerScriptPath={registerScriptPath}
      seeking={seeking}
      mcp={mcp}
      hostedTools={hostedTools}
      custody={manifest.custody}
      door={manifest.door}
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
      publishRecipe={publishRecipe}
      wholeDocumentUnavailable={manifest.unavailable}
    />
  );
}
