// @vitest-environment node
// Built-by: @projectx.sui /|\ · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
/**
 * A document other people's software is built against.
 *
 * # Why this needs more than a smoke test
 *
 * Everything published in the manifest is a claim about code that lives somewhere else — the
 * statements in `packages/sdk/src/statements.ts`, the proof each route demands, the path the route
 * handler sits
 * at, the ids in the environment. A wrong claim here does not fail on our side at all. It fails in
 * somebody's agent, as `FunctionNotFound`, or as "the signature does not prove control of 0x…",
 * which points at their wallet rather than at our document.
 *
 * `test/statement-drift.test.ts` exists because two hand-written copies of one statement drifted
 * inside a single repository. This is the same class of defect with a longer blast radius, so every
 * claim below is checked against the source it is a claim about, rather than against a second copy
 * of the claim.
 *
 * # And a credential must never appear in it
 *
 * The seal committee is permissioned; `SealKeyServer` carries `apiKeyName` and `apiKey` beside the
 * public fields. The serialised document is searched for both, so a field added to that type later
 * cannot reach a stranger's parser by inheritance.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { contentDigest } from '@/app/api/posts/route';
import { fail, ok, type PlatformState, type ProjectXSocialConfig, type SealConfig } from '@projectx-social/sdk';

/** The deployment the published statements are bound to. */
const ORIGIN = 'https://weir.social';
import {
  AGENT_MANIFEST_PATH,
  AGENT_MANIFEST_VERSION,
  REUSABLE_ACTION_KINDS,
  endpointCatalogue,
  manifestFrom,
  statementCatalogue,
  type ManifestInputs,
} from '../lib/agent-manifest';

const web = join(import.meta.dirname, '..');
const read = (path: string): string => readFileSync(join(web, path), 'utf8');

/**
 * The one implementation of the signed-statement format.
 *
 * It lived in `lib/identity.ts` until the hand copy in `packages/agent` was removed; `identity.ts`
 * re-exports it and keeps `verifyAction`, which cannot travel because it spends rows in
 * `used_signatures`. Every claim this manifest makes about a statement is checked against this
 * file, because it is the file an agent's signature is actually verified against.
 */
const STATEMENTS_SOURCE = '../sdk/src/statements.ts';

/** Synthetic ids of the right shape. They belong to nothing, which is the point of a fixture. */
const CONFIG: ProjectXSocialConfig = {
  network: 'mainnet',
  grpcUrl: 'https://fullnode.example.invalid:443',
  packageId: `0x${'a1'.repeat(32)}`,
  latestPackageId: `0x${'b2'.repeat(32)}`,
  platformId: `0x${'c3'.repeat(32)}`,
  registryId: `0x${'d4'.repeat(32)}`,
};

const PLATFORM: PlatformState = {
  version: 1n,
  feeBps: 290n,
  referralShareBps: 500n,
  creationFeeMist: 29_000_000_000n,
  creationPaused: false,
  paymentsPaused: false,
  treasuryMist: 29_000_000_000n,
  accountsCreated: 9n,
  vaultsCreated: 17n,
};

const SEAL: SealConfig = {
  keyServers: [
    {
      objectId: `0x${'e5'.repeat(32)}`,
      weight: 1,
      aggregatorUrl: 'https://seal-aggregator.example.invalid',
      apiKeyName: 'X-API-Key',
      apiKey: 'the-committee-credential-that-must-never-be-published',
    },
  ],
  threshold: 1,
};

function inputs(overrides: Partial<ManifestInputs> = {}): ManifestInputs {
  return {
    origin: 'https://weir.social',
    observedAtMs: 1_756_600_000_000,
    config: ok(CONFIG),
    keyRegistryId: ok(`0x${'f6'.repeat(32)}`),
    mind: ok({ maxBytes: 1_048_576, quota: { capacity: 1, msPerToken: 21_600_000 } }),
    seal: ok(SEAL),
    coinTypes: [`0x${'a7'.repeat(32)}::usdc::USDC`],
    platform: ok(PLATFORM),
    custody: ok({
      upgradeCap: { objectId: `0x${'0a'.repeat(32)}`, holder: ok(`0x${'0b'.repeat(32)}`) },
      platformCap: { objectId: `0x${'0c'.repeat(32)}`, holder: ok(`0x${'0b'.repeat(32)}`) },
    }),
    ...overrides,
  };
}

/**
 * Every `case '…': return \`…\`;` in `statementFor`, as a skeleton.
 *
 * Read from the source rather than written out, and deliberately not pinned to a count. This file
 * is one of several being built against the same `Action` union at once; a hard-coded list of kinds
 * here would fail for the honest reason that somebody added an action, which is a false alarm that
 * teaches people to edit the number rather than read the diff. What must never happen is a kind
 * existing in `identity.ts` and NOT being published — and that is a set comparison, not a count.
 */
function sourceTemplates(): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of read(STATEMENTS_SOURCE).matchAll(/case '([a-z-]+)':\s*\n\s*return `([^`]*)`;/g)) {
    out.set(m[1] ?? '', (m[2] ?? '').replace(/\$\{[^}]*\}/gs, '{}'));
  }
  return out;
}

describe('the statements it publishes', () => {
  const statements = statementCatalogue(ORIGIN);

  it('covers every action the verifier knows about, and invents none', () => {
    /*
      The `SAMPLES` map is a `Record` over the union, so a MISSING kind fails `tsc` rather than
      this test. What this catches is the other two ways it can go wrong: a kind dropped from the
      catalogue at runtime, and a kind published here that `statementFor` has no case for — an
      agent would sign that one and be refused by a verifier that has never heard of it.
    */
    const templates = sourceTemplates();
    expect(templates.size).toBeGreaterThan(10);
    expect([...new Set(statements.map((s) => s.kind))].sort()).toEqual([...templates.keys()].sort());
  });

  it('publishes both forms of every statement that prints a word instead of a slot', () => {
    // `follow`/`unfollow` and `yes`/`no` are branches, not interpolations. An agent handed one form
    // and told it was the only one would sign `following: true` and be refused as a forgery.
    const variants = (kind: string): string[] =>
      statements.filter((s) => s.kind === kind).map((s) => s.variant);
    expect(variants('follow')).toEqual(['following=false', 'following=true']);
    expect(variants('set-perks')).toEqual(['supportersFirst=false', 'supportersFirst=true']);
    expect(statements.filter((s) => s.kind === 'comment')).toHaveLength(1);
  });

  it('publishes exactly what `statementFor` builds, character for character', () => {
    /*
      Read from `packages/sdk/src/statements.ts` and compared skeleton to skeleton — the technique
      `statement-drift.test.ts` uses across the client boundary, pointed the other way. A slot's
      local name differs on the two sides (`{postId}` here, `${action.postId}` there) and is not
      the part that has to agree; the fixed text around the slots is, byte for byte, because that
      is what a wallet signs.

      Note that `\n` in the source is the two-character escape, so the published statement's real
      newlines are written back to escapes before comparing.
    */
    const templates = sourceTemplates();
    /*
      The head now carries the origin, which is published as a real value rather than a slot: an
      agent cannot build valid bytes from a placeholder, and a statement it cannot build is a
      statement it cannot sign.
    */
    const head = `Weir\naddress: {address}\nissued: {issuedAtMs}\norigin: ${ORIGIN}`;

    for (const statement of statements) {
      const published = statement.statement
        // The head is one interpolation on the source side, built once and shared.
        .replace(head, '{}')
        /*
          The two branches. A boolean prints a WORD where the source has an interpolation, so these
          are the only substitutions this comparison is allowed to make — and naming them exactly,
          rather than matching loosely, is what keeps the check strict everywhere else.
        */
        .replace(/action: (follow|unfollow)$/m, 'action: {}')
        .replace(/supporters-first: (yes|no)$/m, 'supporters-first: {}')
        .replaceAll(/\{[a-zA-Z][a-zA-Z0-9]*}/g, '{}')
        .replaceAll('\n', '\\n');

      expect([statement.kind, statement.variant, published]).toEqual([
        statement.kind,
        statement.variant,
        templates.get(statement.kind),
      ]);
    }
  });

  it('leaves no sentinel behind where the issue time goes', () => {
    for (const statement of statements) {
      expect(statement.statement).toContain('{address}');
      expect(statement.statement).toContain('{issuedAtMs}');
      // The sentinel is substituted after the fact because `statementFor` takes a number. Any digit
      // of it surviving means an agent would sign a timestamp we invented.
      expect(statement.statement).not.toMatch(/999999999/);
    }
  });

  it('marks every statement single-use except the ones identity.ts exempts', () => {
    /*
      `isSingleUse` moved with `statementFor` into `@projectx-social/sdk` when the duplicated copy
      of the statement format was removed, and it is exported there because a rule that cannot be
      read cannot be published — this manifest is what publishes it. Exporting the FACT is still a
      different act from sharing the DECISION: nothing outside `verifyAction` may decide whether a
      signature is spent. So the fact is mirrored in the manifest and pinned to the source here. If
      the rule there changes, this fails rather than the manifest quietly telling agents they may
      batch writes on one prompt.

      It pinned "everything except read" until the read exemption was removed. The regex reads the
      RETURN VALUE out of the source, so a rule rewritten to always return true is matched here as
      the literal `true` — pinning the text rather than importing the function, deliberately, since
      importing it would compare the rule against itself.
    */
    /*
      Comments stripped first. The rule's own doc block explains the change in prose that contains
      the word `return`, and the first draft of this assertion matched that sentence instead of the
      statement — reporting a paragraph where it wanted a boolean. A source-matching assertion that
      cannot tell code from a comment about code is matched by nothing that runs.
    */
    const body = read(STATEMENTS_SOURCE)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '')
      .match(/function isSingleUse\(action: Action\): boolean \{[\s\S]*?return ([^;]+);/)?.[1];
    expect(body).toBe('true');
    expect([...REUSABLE_ACTION_KINDS]).toEqual([]);

    for (const statement of statements) {
      expect(statement.singleUse).toBe(true);
    }
  });
});

describe('the endpoints it publishes', () => {
  const endpoints = endpointCatalogue();

  /** `/api/media/{postId}/{assetId}` → the file that answers it. */
  const fileFor = (path: string): string =>
    `app${path.replaceAll('{', '[').replaceAll('}', ']')}/route.ts`;

  it('names a route handler that exists, for every path', () => {
    for (const endpoint of endpoints) {
      expect(() => read(fileFor(endpoint.path))).not.toThrow();
    }
  });

  it('says content-price answers for the machine edition too, and the route does', () => {
    /*
      The claim an agent builds `weir_price` on: `machineBody` tells it whether a machine edition
      can be delivered before it prices one. A manifest that promised the field while the route
      did not compute it — or the reverse — would send an agent to price what cannot be sold.
    */
    const entry = endpoints.find((e) => e.path === '/api/studio/content-price');
    expect(entry?.purpose).toContain('machineBody');
    for (const state of ['sealed', 'no-post', 'absent']) expect(entry?.purpose).toContain(state);
    const source = read(fileFor('/api/studio/content-price'));
    expect(source).toContain('machineBodyState(');
    expect(source).toContain('machineBody,');
  });

  it('puts this document at the path the manifest says it lives at', () => {
    // The constant and the directory are two halves of one claim, and nothing else checks them.
    expect(() => read(`app${AGENT_MANIFEST_PATH}/route.ts`)).not.toThrow();
    expect(endpoints.some((e) => e.path === AGENT_MANIFEST_PATH)).toBe(true);
  });

  it('declares every method the route actually exports, and no method it does not', () => {
    for (const endpoint of endpoints) {
      const source = read(fileFor(endpoint.path));
      const exported = [...source.matchAll(/export async function (GET|POST|PUT|PATCH|DELETE)/g)]
        .map((m) => m[1] ?? '')
        .sort();
      expect([...endpoint.methods].sort()).toEqual(exported);
    }
  });

  it('tells the truth about what proof each endpoint demands', () => {
    /*
      The claim that costs the most to get wrong. An agent told an endpoint needs no signature
      builds the whole flow before the 401 tells it otherwise, and an agent told one needs a
      signature pays for a wallet prompt nobody asked for.
    */
    for (const endpoint of endpoints) {
      const source = read(fileFor(endpoint.path));
      // `proveActionWithoutSpending` (lib/identity.ts) proves a signature exactly as `verifyAction`
      // does and only declines to spend it — the waiting room's route. Either is a signature demand.
      const signs = source.includes('verifyAction') || source.includes('proveActionWithoutSpending');
      const proves = source.includes('provenReaderFor');

      if (endpoint.proof === 'signature') expect([endpoint.path, signs]).toEqual([endpoint.path, true]);
      if (endpoint.proof === 'session') {
        expect([endpoint.path, proves]).toEqual([endpoint.path, true]);
        expect([endpoint.path, signs]).toEqual([endpoint.path, false]);
      }
      if (endpoint.proof === 'none') {
        expect([endpoint.path, signs || proves]).toEqual([endpoint.path, false]);
      }
    }
  });

  /*
    A budget may be spent directly, or through a named guard that spends it and nothing else.

    `simulate` is spent by `simulateLimit`, which runs the per-process Map and then a durable
    Postgres bucket — because those routes each build a transaction and call a fullnode we pay for,
    and a per-instance ceiling is not a ceiling on that. The manifest's claim is unchanged and still
    true: the endpoint spends the `simulate` budget. Only the function that spends it moved.

    Stated as a mapping rather than as an `||` in the assertion, so a future guard has to be
    declared here to count — which is the same review a new budget would get.
  */
  const SPENT_BY: Partial<Record<string, string>> = { simulate: 'simulateLimit(' };

  it('names the rate-limit budget the route actually spends', () => {
    for (const endpoint of endpoints) {
      const source = read(fileFor(endpoint.path));
      const direct = source.includes(`rateLimit(request, '${endpoint.budget}')`);
      const guard = SPENT_BY[endpoint.budget];
      const viaGuard = guard !== undefined && source.includes(guard);
      expect([endpoint.path, direct || viaGuard]).toEqual([endpoint.path, true]);
    }
  });

  it('names query parameters the route actually reads', () => {
    for (const endpoint of endpoints) {
      const source = read(fileFor(endpoint.path));
      for (const parameter of endpoint.query) {
        expect([endpoint.path, parameter, source.includes(`.get('${parameter}')`)]).toEqual([
          endpoint.path,
          parameter,
          true,
        ]);
      }
    }
  });

  it('names body fields the request handler actually reads', () => {
    /*
      A field the handler never reads is a field an agent sends and watches be ignored, and the
      failure surfaces as a 400 naming something else entirely.

      The search covers the route and the `@/lib` modules it imports, because validation does not
      always live in the handler: `/api/agents/declare` parses the body as `Record<string, unknown>`
      and hands it to `validateDeclaration`, where the fields are read as `input['name']`. Both
      forms are precise — a destructured `name?:` and an indexed `['name']` — so this does not
      degrade into searching for a word in prose.
    */
    for (const endpoint of endpoints) {
      const route = read(fileFor(endpoint.path));
      const imported = [...route.matchAll(/from '@\/lib\/([\w-]+)'/g)]
        .map((m) => read(`lib/${m[1] ?? ''}.ts`))
        .join('\n');
      const searched = `${route}\n${imported}`;

      for (const field of endpoint.body) {
        const named =
          new RegExp(`\\b${field}\\?:`).test(searched) || searched.includes(`['${field}']`);
        expect([endpoint.path, field, named]).toEqual([endpoint.path, field, true]);
      }
    }
  });
});

describe('the document as a whole', () => {
  it('has the wire shape `weir-agent/1` promises', () => {
    /*
      The version string is a promise to strangers, and this is the only thing that keeps it. A
      renamed or dropped key is not a bug on our side at all — the consumer reads `undefined`,
      treats it as absent, and carries on with a wrong assumption instead of an error. Adding a key
      is allowed and does not fail here; removing or renaming one does, and the fix is to change
      `AGENT_MANIFEST_VERSION` rather than to edit this list.
    */
    const manifest = manifestFrom(inputs());
    const required = [
      'manifest',
      // The document's own revision, and the block a reader checks these bytes with. Both are
      // inside the signed payload on purpose: an attacker who edits either has changed what the
      // detached JWS was computed over. See `lib/agent-manifest.ts`.
      'version',
      'integrity',
      'service',
      'origin',
      'observedAtMs',
      'note',
      'unavailable',
      'chain',
      'money',
      'seal',
      'sealUnavailable',
      'authentication',
      'endpoints',
      'rateLimits',
      'disclosure',
      'mcp',
      'custody',
      'custodyUnavailable',
      'mind',
      'mindUnavailable',
    ];
    expect(Object.keys(manifest).sort()).toEqual([...required].sort());

    expect(Object.keys(manifest.chain ?? {}).sort()).toEqual(
      [
        'network',
        'grpcUrl',
        'jsonRpc',
        'transportNote',
        'originalPackageId',
        'latestPackageId',
        'packageNote',
        'useOriginalFor',
        'useLatestFor',
        'platformId',
        'registryId',
        'keyRegistryId',
        'keyRegistryUnavailable',
        'explorer',
      ].sort(),
    );

    for (const statement of manifest.authentication.statements) {
      /*
        `computed` is optional and present on `publish` alone (revision 11). It is checked as an
        allowed EXTRA rather than added to the required set, so a statement that grows it without
        reason still fails here, and one that loses it on publish fails the recipe tests below.
      */
      const keys = Object.keys(statement).sort();
      const required = ['kind', 'singleUse', 'statement', 'variant'];
      expect(keys.filter((k) => k !== 'computed')).toEqual(required);
      if (keys.includes('computed')) expect(statement.kind).toBe('publish');
    }
    for (const endpoint of manifest.endpoints) {
      expect(Object.keys(endpoint).sort()).toEqual([
        'body',
        'budget',
        'methods',
        'path',
        'proof',
        'purpose',
        'query',
      ]);
    }
  });

  it('carries the ids from configuration and nothing invented', () => {
    const manifest = manifestFrom(inputs());
    expect(manifest.manifest).toBe(AGENT_MANIFEST_VERSION);
    expect(manifest.unavailable).toBeNull();
    expect(manifest.chain?.originalPackageId).toBe(CONFIG.packageId);
    expect(manifest.chain?.latestPackageId).toBe(CONFIG.latestPackageId);
    expect(manifest.chain?.platformId).toBe(CONFIG.platformId);
    expect(manifest.chain?.registryId).toBe(CONFIG.registryId);
    expect(manifest.chain?.network).toBe('mainnet');
    // The two ids are different values on an upgraded deployment, and the document has to say which
    // is which rather than leaving a reader to pick one.
    expect(manifest.chain?.originalPackageId).not.toBe(manifest.chain?.latestPackageId);
    expect(manifest.seal?.namespacePackageId).toBe(CONFIG.packageId);
    expect(manifest.seal?.approveTargets.every((t) => t.startsWith(CONFIG.latestPackageId))).toBe(
      true,
    );
  });

  it('never publishes the key server credential', () => {
    const serialised = JSON.stringify(manifestFrom(inputs()));
    expect(serialised).not.toContain('the-committee-credential-that-must-never-be-published');
    expect(serialised).not.toContain('apiKey');
    expect(serialised).not.toContain('X-API-Key');
    // What it does publish: the object id and the aggregator, which are how anybody verifies the
    // committee independently.
    expect(serialised).toContain(SEAL.keyServers[0]?.objectId ?? 'missing');
  });

  it('reports amounts as strings, because a bigint fee is not a JSON number', () => {
    const manifest = manifestFrom(inputs());
    expect(manifest.money?.platform?.feeBps).toBe('290');
    expect(manifest.money?.platform?.creationFeeMist).toBe('29000000000');
    expect(manifest.money?.platform?.readFrom).toBe(CONFIG.platformId);
  });

  it('says the platform could not be read rather than printing a zero fee', () => {
    /*
      The one that would cost somebody money. A manifest reporting `feeBps: 0` because a node timed
      out tells an agent it can sell something for nothing, and the agent has no way to tell that
      from a genuinely free platform.
    */
    const manifest = manifestFrom(
      inputs({ platform: fail('transport', 'Platform', 'the node did not answer') }),
    );
    expect(manifest.money?.platform).toBeNull();
    expect(manifest.money?.platformUnavailable).toContain('did not answer');
    expect(JSON.stringify(manifest.money)).not.toContain('"feeBps"');
    // The rest of the document still stands: an agent that cannot learn the fee can still learn
    // what to sign.
    expect(manifest.chain?.latestPackageId).toBe(CONFIG.latestPackageId);
    expect(manifest.authentication.statements.length).toBeGreaterThan(10);
  });

  it('is empty and honest on a deployment that is not configured', () => {
    const manifest = manifestFrom(
      inputs({ config: fail('unconfigured', 'ProjectXSocialConfig', 'PROJECTX_SOCIAL_NETWORK is not set') }),
    );
    expect(manifest.chain).toBeNull();
    expect(manifest.money).toBeNull();
    expect(manifest.seal).toBeNull();
    expect(manifest.unavailable).toContain('PROJECTX_SOCIAL_NETWORK');
    // Statements are a property of the code, not of a deployment, so they survive.
    expect(manifest.authentication.statements.length).toBeGreaterThan(10);
  });

  it('reports an absent key registry as absent rather than as an empty id', () => {
    const manifest = manifestFrom(
      inputs({ keyRegistryId: fail('unconfigured', 'KeyRegistry', 'KEY_REGISTRY_ID is not set') }),
    );
    expect(manifest.chain?.keyRegistryId).toBeNull();
    expect(manifest.chain?.keyRegistryUnavailable).toContain('KEY_REGISTRY_ID');
  });

  it('publishes the live rate-limit budgets rather than a written-down copy', () => {
    // Imported from `lib/rate-limit.ts`, so a budget changed there changes here. A copy would tell
    // agents to pace themselves against a limit that no longer exists.
    const manifest = manifestFrom(inputs());
    expect(Object.keys(manifest.rateLimits.budgets).sort()).toEqual(['read', 'simulate', 'write']);
    for (const budget of Object.values(manifest.rateLimits.budgets)) {
      expect(budget.limit).toBeGreaterThan(0);
      expect(budget.windowMs).toBeGreaterThan(0);
    }
  });

  it('describes the session in the terms the code actually implements', () => {
    const manifest = manifestFrom(inputs());
    const session = manifest.authentication.session;
    const source = read('lib/read-session.ts');

    expect(source).toContain(`export const READ_SESSION_COOKIE = '${session.cookie}'`);
    expect(session.bearer).toBe('Authorization: Bearer <token>');
    // The token is asked for with a header, never returned by default — revision 4.
    expect(session.returns).toEqual(['address', 'expiresAtMs']);
    expect(session.bearerHeader.adds).toBe('token');
    // And the mint route really does return all three.
    const route = read('app/api/session/route.ts');
    for (const field of session.returns) expect(route).toContain(field);
  });

  it('states the head every statement is actually built on', () => {
    const manifest = manifestFrom(inputs());
    for (const statement of manifest.authentication.statements) {
      expect(statement.statement.startsWith(manifest.authentication.head)).toBe(true);
    }
    expect(manifest.authentication.head).toContain('address: {address}');
    expect(manifest.authentication.head).toContain('issued: {issuedAtMs}');
  });

  it('grounds the disclosure requirement in a section the Terms actually contain', () => {
    // A rule published for strangers that cites a clause we do not have is worse than no rule.
    const terms = read('content/legal/terms.md');
    expect(terms).toContain('access it by automated means except through documented public APIs');
    expect(terms).toContain('impersonate any person or entity');
    const manifest = manifestFrom(inputs());
    expect(manifest.disclosure.basis).toContain('6(d)');
    expect(manifest.disclosure.basis).toContain('6(g)');
    expect(manifest.disclosure.notEnforced).not.toBe('');
  });
});

describe('the hosted MCP section', () => {
  it('names an https endpoint and only reading tools', () => {
    const manifest = manifestFrom(inputs());
    expect(manifest.mcp.hosted.startsWith('https://')).toBe(true);
    expect(manifest.mcp.mode).toBe('read-only');
    /*
      The invariant, not an allowlist. This was a list of four names including `weir_balance`, which
      the keyless build does not register because balance needs a signer — so the test passed while
      the document promised a tool the endpoint refuses to have. Adding a name to an allowlist is
      not a check; refusing every tool that spends is.
    */
    expect(manifest.mcp.tools.length).toBeGreaterThan(0);
    for (const tool of manifest.mcp.tools) {
      expect(tool.startsWith('weir_')).toBe(true);
      expect(['weir_buy', 'weir_subscribe', 'weir_post', 'weir_send', 'weir_price']).not.toContain(tool);
      // `weir_balance` reads, but only for a bound signer, and this endpoint has none.
      expect(tool).not.toBe('weir_balance');
    }
    expect(manifest.mcp.note).toContain('exits before listening');
  });
});

describe('the published quotas', () => {
  it('mirror QUOTAS exactly, and name the purchase bucket the submit route spends', async () => {
    const { QUOTAS } = await import('../lib/rate-limit');
    const manifest = manifestFrom(inputs());
    for (const [name, quota] of Object.entries(QUOTAS)) {
      expect(manifest.rateLimits.quotas[name]).toEqual({ capacity: quota.capacity, msPerToken: quota.msPerToken });
    }
    expect(manifest.rateLimits.quotasNote).toContain('/api/checkout/submit');
  });
});

describe('custody and the session token, told truthfully', () => {
  it('publishes both capability ids and the holder the chain reported', () => {
    const manifest = manifestFrom(inputs());
    expect(manifest.custody?.upgradeCap.objectId).toBe(`0x${'0a'.repeat(32)}`);
    expect(manifest.custody?.upgradeCap.holder).toBe(`0x${'0b'.repeat(32)}`);
    expect(manifest.custody?.platformCap.holder).toBe(`0x${'0b'.repeat(32)}`);
    expect(manifest.custodyUnavailable).toBeNull();
  });

  it('an unreadable holder is null with its reason, never a guessed address', () => {
    const manifest = manifestFrom(
      inputs({
        custody: ok({
          upgradeCap: { objectId: `0x${'0a'.repeat(32)}`, holder: fail('transport', 'owner', 'node down') },
          platformCap: { objectId: `0x${'0c'.repeat(32)}`, holder: ok(`0x${'0b'.repeat(32)}`) },
        }),
      }),
    );
    expect(manifest.custody?.upgradeCap.holder).toBeNull();
    expect(manifest.custody?.upgradeCap.holderUnavailable).toContain('node down');
  });

  it('says calmly when no capability ids are configured', () => {
    const manifest = manifestFrom({ ...inputs(), custody: undefined });
    expect(manifest.custody).toBeNull();
    expect(manifest.custodyUnavailable).toMatch(/not configured/);
  });

  it('does not promise a session token by default, and names the header that adds it', () => {
    const manifest = manifestFrom(inputs());
    expect(manifest.authentication.session.returns).not.toContain('token');
    expect(manifest.authentication.session.bearerHeader).toEqual({ name: 'x-weir-bearer', value: '1', adds: 'token' });
  });
});

describe('the two profile routes are listed with exactly the fields they parse', () => {
  /*
    The first unguided outside agent (2026-09-02) opened a vault and then could not name it: the
    `name-vault` statement was in the catalogue with no endpoint beside it. These read the ROUTE
    SOURCE for the fields it destructures from the body and assert the manifest lists the same
    set — so the manifest cannot drift from the route again without this going red.
  */
  const fieldsParsedBy = (routePath: string): string[] => {
    const source = readFileSync(join(process.cwd(), 'app/api', routePath, 'route.ts'), 'utf8');
    const block = source.slice(source.indexOf('await request.json()'), source.indexOf('};', source.indexOf('await request.json()')));
    return [...block.matchAll(/\b([a-zA-Z]+)\?:/g)].map((m) => m[1] as string).sort();
  };

  it('/api/creator/profile — name-vault', () => {
    const manifest = manifestFrom(inputs());
    const entry = manifest.endpoints.find((e) => e.path === '/api/creator/profile');
    expect(entry).toBeDefined();
    expect(entry?.methods).toEqual(['POST']);
    expect(entry?.proof).toBe('signature');
    expect([...(entry?.body ?? [])].sort()).toEqual(fieldsParsedBy('creator/profile'));
    expect(entry?.purpose).toContain('name-vault');
  });

  it('/api/account/profile — set-profile', () => {
    const manifest = manifestFrom(inputs());
    const entry = manifest.endpoints.find((e) => e.path === '/api/account/profile');
    expect(entry).toBeDefined();
    expect(entry?.proof).toBe('signature');
    expect([...(entry?.body ?? [])].sort()).toEqual(fieldsParsedBy('account/profile'));
  });
});

/*
  The recipe for `contentSha256`, checked against the code that actually computes it.

  This is the drift test for finding 1 of 2026-09-02: an agent spent two sessions failing to publish
  because the digest is length-prefixed and nothing we serve said so. Publishing the recipe fixes
  that only if the recipe stays true, so it is built here from the words in the manifest and
  compared against the route's own function on real values.
*/
describe('the publish digest recipe', () => {
  const digestAsDocumented = (preview: string, text: string) =>
    createHash('sha256').update(`${preview.length}:${preview}${text.length}:${text}`).digest('hex');

  it('is published on the publish statement, and nowhere else', () => {
    const manifest = manifestFrom(inputs());
    const publish = manifest.authentication.statements.filter((s) => s.kind === 'publish');
    expect(publish.length).toBeGreaterThan(0);
    for (const s of publish) expect(s.computed?.contentSha256).toBeTruthy();
    // Every other statement's slots are literal values the caller already holds.
    for (const s of manifest.authentication.statements.filter((s) => s.kind !== 'publish')) {
      expect(s.computed).toBeUndefined();
    }
  });

  it('describes what the deployment actually computes', () => {
    const manifest = manifestFrom(inputs());
    const recipe =
      manifest.authentication.statements.find((s) => s.kind === 'publish')?.computed?.contentSha256 ?? '';
    // The three things the recipe must say, because each one is a way to get it wrong.
    expect(recipe).toMatch(/preview\.length/);
    expect(recipe).toMatch(/text\.length/);
    expect(recipe).toMatch(/NOT sha256 of the text/);
    // And it must be true. Values chosen so a wrong construction cannot coincide: the naive
    // `sha256(preview + text)` and the documented form differ for every one of these.
    const cases: Array<[string, string]> = [
      ['', ''],
      ['a', 'b'],
      ['12:34', '5'],
      ['préview with é', 'text with 🦞 and a newline\n'],
      ['x'.repeat(300), 'y'.repeat(5000)],
    ];
    for (const [preview, text] of cases) {
      const documented = digestAsDocumented(preview, text);
      expect(documented).not.toBe(createHash('sha256').update(preview + text).digest('hex'));
      expect(documented).toBe(contentDigest(preview, text));
    }
  });
});
