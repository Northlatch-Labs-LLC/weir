// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
import { NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import { AGENT_MANIFEST_PATH, servedManifest } from '@/lib/agent-manifest';

export const dynamic = 'force-dynamic';

export interface McpDiscovery {
  name: string;
  description: string;
  endpoint: string;
  transport: 'streamable-http';
  tools: string[];
  readOnly: boolean;
  authentication: 'none';
  documentation: string;
  manifest: string;
  note: string;
}

export function capabilitiesSentence(tools: readonly string[]): string {
  const has = (name: string): boolean => tools.includes(name);
  const can: string[] = [];
  if (has('weir_search') || has('weir_read')) can.push('read what a creator published');
  if (has('weir_quote')) can.push('price it from the chain');
  if (has('weir_authorship')) can.push('check who signed it');
  if (has('weir_agents') || has('weir_seeking')) can.push('see the other agents');
  if (has('weir_balance')) can.push('check a balance');
  if (can.length === 0) return 'this endpoint registers no tools';
  return can.length === 1 ? (can[0] ?? '') : `${can.slice(0, -1).join(', ')}, and ${can[can.length - 1]}`;
}

export async function discoveryFor(origin: string): Promise<McpDiscovery> {
  const { manifest } = await servedManifest(origin);
  const network = manifest.chain?.network;
  return {
    name: manifest.service,
    description:
      `${manifest.service}${network ? ` on Sui ${network}` : ''}: ${capabilitiesSentence(manifest.mcp.tools)}. ` +
      'An agent holds the same account a person holds.',
    endpoint: manifest.mcp.hosted,
    transport: 'streamable-http',
    tools: [...manifest.mcp.tools],
    readOnly: manifest.mcp.mode === 'read-only',
    authentication: 'none',
    documentation: `${origin}/llms.txt`,
    manifest: `${origin}${AGENT_MANIFEST_PATH}`,
    note:
      `${manifest.mcp.note} There is no ratified standard for this file; it is served because ` +
      'clients ask for it. The signed manifest is the authority, and this document is derived from it.',
  };
}

function originOf(request: Request): string {
  const url = new URL(request.url);
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  const proto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
  if (host === null || host.trim() === '') return url.origin;
  return `${proto === undefined || proto === '' ? url.protocol.replace(':', '') : proto}://${host.trim()}`;
}

export async function GET(request: Request) {
  const limited = rateLimit(request, 'read');
  if (limited !== null) return limited;
  return NextResponse.json(await discoveryFor(originOf(request)), {
    headers: {
      'cache-control': 'public, max-age=300',
      'access-control-allow-origin': '*',
    },
  });
}
