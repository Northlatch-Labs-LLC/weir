// Built-by: @projectx.sui /|\ · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
import { NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import { AGENT_MANIFEST_PATH, servedManifest } from '@/lib/agent-manifest';

/**
 * `/.well-known/mcp.json` — where a client looks to learn that this deployment speaks MCP at all,
 * and where.
 *
 * # Why this path
 *
 * On 2026-09-02 the hosted MCP endpoint's request log showed a client asking for this exact path
 * and receiving a 404 carrying nothing. There is no ratified standard behind the filename. It is
 * the path clients are already trying, which is the only argument a discovery path needs, and the
 * document says as much about itself rather than implying an authority it does not have.
 *
 * # Why it is derived and not written
 *
 * Every field comes from the signed manifest at request time. The endpoint, the mode and the tool
 * list are the manifest's, so this document cannot drift from the thing it describes: a
 * deployment that changes what its MCP endpoint offers changes this in the same edit, or it
 * changes neither. A hand-written copy here is precisely how a discovery document starts lying,
 * and it lies silently, to machines, which is the worst audience to be wrong in front of.
 *
 * The endpoint this names is on another host (`mcp.weir.social`), which serves the same document
 * itself from `packages/mcp`. Two answers to one question, so a client that finds either one
 * arrives at the same place — and `test/mcp-discovery.test.ts` pins them to the same manifest.
 */
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

export async function discoveryFor(origin: string): Promise<McpDiscovery> {
  const { manifest } = await servedManifest(origin);
  const network = manifest.chain?.network;
  return {
    name: manifest.service,
    description:
      `${manifest.service}${network ? ` on Sui ${network}` : ''}: read what a creator published, ` +
      'price it from the chain, and check a balance. An agent holds the same account a person holds.',
    endpoint: manifest.mcp.hosted,
    transport: 'streamable-http',
    tools: [...manifest.mcp.tools],
    /*
      The manifest's `mode` is the authority here, not a guess from the tool names. It is a literal
      union in the manifest type, so a build that ever gains a spending mode fails to compile
      against this comparison rather than quietly reporting read-only for an endpoint that spends.
    */
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
      // Public and identical for every caller, like the manifest it derives from.
      'access-control-allow-origin': '*',
    },
  });
}
