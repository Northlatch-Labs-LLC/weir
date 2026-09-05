// Built-by: @projectx.sui · Co-authored-by: Claude
import { NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import { AGENT_MANIFEST_PATH, servedManifest } from '@/lib/agent-manifest';

/**
 * `/.well-known/agent-registration.json` — the ERC-8004 shape of this deployment, beside the
 * manifest and never in its place.
 *
 * # What ERC-8004 tooling looks for
 *
 * The standard's registration file is a JSON document of type
 * `https://eips.ethereum.org/EIPS/eip-8004#registration-v1` naming the agent, its services and
 * its on-chain registrations, and it says an agent "MAY optionally prove control of an HTTPS
 * endpoint-domain by publishing `https://{endpoint-domain}/.well-known/agent-registration.json`
 * containing at least a `registrations` list (or the full agent registration file)". This is the
 * full file. The signed manifest at `/.well-known/weir-agent.json` is untouched: it is listed as
 * a service here, and everything in this document is derived from it at request time.
 *
 * # What is true and what is not yet
 *
 * `registrations` is empty because this deployment is registered in no identity registry yet.
 * Registering is an on-chain act under the owner's key, and a registration written here before it
 * exists on chain would be the exact false claim this file is meant to let a reader rule out.
 * `x402Support` is false for a DIFFERENT reason, and the difference matters to anyone reading this
 * file to decide whether to wait for it. `registrations` is empty because the on-chain act has not
 * happened yet, and it flips when it does. `x402Support` is false because payment on Weir settles
 * on chain from the buyer's own key, in SUI and USDC, and there is no HTTP payment-negotiation
 * layer — no 402 response, no X-PAYMENT header, no facilitator. That was decided on 2026-09-02 and
 * it is settled rather than pending. An agent that buys calls `creator::unlock` with its own key,
 * exactly as `@projectx-social/agent` does; that is the whole payment story.
 *
 * So: `registrations` flips when the fact changes. `x402Support` does not, because the fact is not
 * going to change.
 */
export const REGISTRATION_TYPE = 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1';

export interface Registration {
  type: typeof REGISTRATION_TYPE;
  name: string;
  description: string;
  image: string;
  services: Array<{ name: string; endpoint: string; version?: string }>;
  x402Support: boolean;
  active: boolean;
  registrations: Array<{ agentId: number; agentRegistry: string }>;
}

export async function registrationFor(origin: string): Promise<Registration> {
  const { manifest } = await servedManifest(origin);
  /*
    Built from facts the manifest carries, not from prose. The first draft put `manifest.note`
    here, which reads well until you read it: it is the manifest's disclaimer about null sections,
    not a description of anything. It was caught by fetching the route and reading the JSON, which
    is the only way a plausible wrong value ever gets caught.

    Network is included only when the manifest measured one; an unconfigured deployment says
    nothing about a chain rather than guessing one.
  */
  const network = manifest.chain?.network;
  const description =
    `${manifest.service}${network ? ` on Sui ${network}` : ''}: an agent holds the same on-chain account ` +
    `a person holds, through the same call. ${manifest.endpoints.length} documented HTTP endpoints; ` +
    `signed manifest at ${AGENT_MANIFEST_PATH}; operator page at /agents.`;
  return {
    type: REGISTRATION_TYPE,
    name: manifest.service,
    description,
    image: `${origin}/og-default.png`,
    services: [
      { name: 'web', endpoint: `${origin}/agents` },
      // Not a standard service name, and deliberately not "A2A" or "MCP": neither is served at a
      // URL. The manifest is what a machine reads here, so it is named as what it is.
      { name: 'weir-agent-manifest', endpoint: `${origin}${AGENT_MANIFEST_PATH}`, version: manifest.manifest },
    ],
    x402Support: false,
    active: true,
    registrations: [],
  };
}

function originOf(request: Request): string {
  const url = new URL(request.url);
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  const proto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
  if (host === null || host.trim() === '') return url.origin;
  return `${proto === undefined || proto === '' ? url.protocol.replace(':', '') : proto}://${host.trim()}`;
}

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const limited = rateLimit(request, 'read');
  if (limited !== null) return limited;
  return NextResponse.json(await registrationFor(originOf(request)), {
    headers: {
      'cache-control': 'public, max-age=60',
      // Public and identical for every caller, like the manifest it derives from.
      'access-control-allow-origin': '*',
    },
  });
}
