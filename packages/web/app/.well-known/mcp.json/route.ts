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

/**
 * What the hosted endpoint can do, said from its tool list and from nothing else.
 *
 * This sentence used to be written by hand and said "and check a balance" while the tool list beside
 * it — the manifest's, and the endpoint's own — had no `weir_balance`: a balance needs a signer and
 * the hosted build has none by construction. The list was derived and the sentence was not, so the
 * two disagreed for two days. `packages/mcp` derives its sentence the same way from what it
 * registered; `test/mcp-discovery.test.ts` holds this one to the manifest's list.
 */
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
