// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import { NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import { AGENT_MANIFEST_PATH, servedManifest } from '@/lib/agent-manifest';

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
      'access-control-allow-origin': '*',
    },
  });
}
