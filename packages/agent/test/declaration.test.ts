// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
/*
  `declaration` — one address's entry in the register, and the three answers it must keep apart.

  This is the read a tether control turns on: `packages/mcp`'s `requireLiveTether` refuses to publish
  or send unless this method reports a standing declaration. So the properties that matter are not
  "it parses the happy case" but the ones a careless implementation collapses:

    - a 404 is `ok(null)` — "not in the register", the answer for nearly every address — and is NOT
      a failure;
    - a failure is NOT `ok(null)`, because "we could not look" and "nobody has said" send a caller in
      opposite directions;
    - a WITHDRAWN declaration comes back with `revokedAtMs` set rather than being hidden, so the
      caller is forced to read the field rather than inferring a tether from the row's existence;
    - a malformed `revokedAtMs` reads as revoked, not as live.

  Mutations predicted: map every failure to ok(null) → "a transport failure is not an empty answer"
  red; drop the 404 branch → "an address nobody declared is null, not a failure" red; default a
  missing revokedAtMs to null → "a revokedAtMs that is not a number reads as revoked" red.
*/
import type { SuiGrpcClient } from '@mysten/sui/grpc';
import { describe, expect, it } from 'vitest';
import { createAgent, MAINNET_RECORD } from '../src/index.js';

const ENV = {
  PROJECTX_SOCIAL_NETWORK: 'mainnet',
  PROJECTX_SOCIAL_GRPC_URL: 'https://fullnode.mainnet.sui.io:443',
  PROJECTX_SOCIAL_PACKAGE_ID: MAINNET_RECORD.packageId,
  PROJECTX_SOCIAL_LATEST_PACKAGE_ID: MAINNET_RECORD.latestPackageId,
  PROJECTX_SOCIAL_PLATFORM_ID: MAINNET_RECORD.platformId,
  PROJECTX_SOCIAL_REGISTRY_ID: MAINNET_RECORD.registryId,
  PROJECTX_SOCIAL_AGENT_COIN_TYPE: MAINNET_RECORD.usdcType,
  PROJECTX_SOCIAL_AGENT_BASE_URL: 'https://weir.social',
};

const AGENT = `0x${'1a'.repeat(32)}`;
const OPERATOR = `0x${'2b'.repeat(32)}`;

function keyless(answer: (url: string) => { status: number; body: unknown }) {
  const fetchImpl = (async (url: string) => {
    const a = answer(url);
    return { ok: a.status >= 200 && a.status < 300, status: a.status, json: async () => a.body };
  }) as unknown as NonNullable<Parameters<typeof createAgent>[0]['fetchImpl']>;
  const made = createAgent({ keypair: null, config: ENV, client: {} as SuiGrpcClient, fetchImpl });
  if (!made.ok) throw new Error(made.failure.detail);
  return made.value;
}

/** What the route sends for a standing declaration. */
const STANDING = {
  address: AGENT,
  operatorAddress: OPERATOR,
  model: 'pi-coding-agent',
  purpose: 'reads Move contracts',
  declaredAtMs: 1_788_400_000_000,
  revokedAtMs: null,
};

describe('declaration', () => {
  it('reads the single-address route, not the register listing', async () => {
    let asked = '';
    const agent = keyless((url) => {
      asked = url;
      return { status: 200, body: { agent: STANDING } };
    });
    await agent.declaration({ address: AGENT });
    /*
      The list endpoint cannot answer this question — it filters revoked rows and caps its page —
      so reading it here would be the defect wearing the shape of a fix.
    */
    expect(asked).toBe(`https://weir.social/api/agents/${AGENT}`);
    expect(asked).not.toContain('?operator=');
  });

  it('maps a standing declaration to its fields, with revokedAtMs null', async () => {
    const agent = keyless(() => ({ status: 200, body: { agent: STANDING } }));
    const r = await agent.declaration({ address: AGENT });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toEqual({
        address: AGENT,
        operatorAddress: OPERATOR,
        model: 'pi-coding-agent',
        purpose: 'reads Move contracts',
        declaredAtMs: 1_788_400_000_000,
        revokedAtMs: null,
      });
    }
  });

  it('an address nobody declared is null, not a failure', async () => {
    const agent = keyless(() => ({ status: 404, body: { error: 'this address is not in the agent register' } }));
    const r = await agent.declaration({ address: AGENT });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBeNull();
  });

  it('a WITHDRAWN declaration is returned with revokedAtMs set, never hidden', async () => {
    /*
      The route deliberately answers 200 for a revoked row so a relationship that ended can be told
      apart from one that never existed. A caller that reads the row's existence as a tether is
      wrong, and it can only be wrong if this method passes the field through.
    */
    const revokedAtMs = 1_788_500_000_000;
    const agent = keyless(() => ({ status: 200, body: { agent: { ...STANDING, revokedAtMs } } }));
    const r = await agent.declaration({ address: AGENT });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).not.toBeNull();
      expect(r.value?.revokedAtMs).toBe(revokedAtMs);
    }
  });

  it('a transport failure is not an empty answer', async () => {
    const agent = keyless(() => ({ status: 503, body: { error: 'the register is unavailable' } }));
    const r = await agent.declaration({ address: AGENT });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failure.detail).toContain('the register is unavailable');
  });

  it('a 200 without an agent object is malformed, not an absent declaration', async () => {
    const agent = keyless(() => ({ status: 200, body: { notTheField: {} } }));
    const r = await agent.declaration({ address: AGENT });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failure.kind).toBe('malformed');
  });

  it('a revokedAtMs that is not a number reads as revoked, never as live', async () => {
    /*
      The safe default, and the only field here that gets one. A renamed or dropped field would
      otherwise turn every caller's tether check into a check that passes for everybody — a failure
      that logs nothing and keeps answering "yes".
    */
    const agent = keyless(() => ({ status: 200, body: { agent: { ...STANDING, revokedAtMs: 'yesterday' } } }));
    const r = await agent.declaration({ address: AGENT });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value?.revokedAtMs).not.toBeNull();
  });

  it('is on the keyless surface: asking who is tethered needs no key', async () => {
    const agent = keyless(() => ({ status: 200, body: { agent: STANDING } }));
    expect(typeof agent.declaration).toBe('function');
  });
});
