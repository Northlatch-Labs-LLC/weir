// @vitest-environment node
// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
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
import {
  fail,
  HANDLE_CHARSET_PATTERN,
  MAX_HANDLE_LEN,
  MIN_HANDLE_LEN,
  ok,
  type PlatformState,
  type ProjectXSocialConfig,
  type SealConfig,
} from '@projectx-social/sdk';

/** The deployment the published statements are bound to. */
const ORIGIN = 'https://weir.social';
import {
  AGENT_MANIFEST_PATH,
  AGENT_MANIFEST_VERSION,
  REUSABLE_ACTION_KINDS,
  UNPUBLISHED_ACTION_KINDS,
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
    /*
      A closed door with a date, because that is the state this deployment is actually in and a
      test that fed the open default would never render the half of the block a reader depends on.
      Overridden where a case needs the other branch.
    */
    door: { peopleGated: true, peopleOnboardFrom: { atMs: 1_796_083_200_000, label: 'people onboard from' } },
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

  it('covers every action the verifier knows about except the ones it names, and invents none', () => {
    /*
      The `SAMPLES` map is a `Record` over the union, so a MISSING kind fails `tsc` rather than
      this test. What this catches is the other two ways it can go wrong: a kind dropped from the
      catalogue at runtime, and a kind published here that `statementFor` has no case for — an
      agent would sign that one and be refused by a verifier that has never heard of it.

      Changed 2026-09-03, when `onramp` stopped being published. The assertion used to be
      "everything `statementFor` knows", which was the right shape while the two sets were equal
      and the wrong one the moment a kind was deliberately withheld. It is now
      templates − `UNPUBLISHED_ACTION_KINDS`, which still fails on a kind that quietly disappears:
      dropping one from the catalogue without also naming it in that list does not make this pass.
    */
    const templates = sourceTemplates();
    expect(templates.size).toBeGreaterThan(10);
    const withheld = new Set<string>(UNPUBLISHED_ACTION_KINDS);
    expect([...new Set(statements.map((s) => s.kind))].sort()).toEqual(
      [...templates.keys()].filter((k) => !withheld.has(k)).sort(),
    );
  });

  it('withholds only kinds the verifier actually has, and withholds at least one deliberately', () => {
    /*
      The exclusion list is the one place a typo would be invisible: a misspelled kind excludes
      nothing and reads as a decision that was taken. So every name in it must be a case
      `statementFor` really has — and the list must not silently grow into the whole union, which
      would leave an agent with a document that publishes no statement at all.
    */
    const templates = sourceTemplates();
    for (const kind of UNPUBLISHED_ACTION_KINDS) {
      expect([kind, templates.has(kind)]).toEqual([kind, true]);
    }
    expect(UNPUBLISHED_ACTION_KINDS.length).toBeLessThan(templates.size);
  });

  it('publishes no statement that names a wallet to fund, because payment settles on chain', () => {
    // `onramp` is the card-to-coins door and it is a browser flow. It carried no endpoint in the
    // catalogue, so an agent reading this document was handed bytes to sign and nowhere to send
    // them. Asserted on the built statements, not on the exclusion list, so this stays true even
    // if the mechanism for withholding it changes.
    expect(statements.map((s) => s.kind)).not.toContain('onramp');
    for (const s of statements) expect(s.statement).not.toContain('action: fund wallet');
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

describe('the walkthrough points only at routes this document catalogues', () => {
  const endpoints = endpointCatalogue();
  const paths = new Set(endpoints.map((e) => e.path));
  const manifest = manifestFrom(inputs());

  it('every step whose `get` is an API path names one the catalogue carries', () => {
    /*
      `startHere.thenWhat[7].get` was `/api/earnings` while the catalogue listed 29 endpoints and
      not that one. An agent reading this document straight through met two of its own sections
      disagreeing about whether a route exists, and the careful reading — believe the catalogue —
      is the one that skips getting paid.

      Only `/api/` steps are checked: the others point at pages (`/agents/declare`) and at a script
      (`/register-agent.mjs`), which are not endpoints and are not catalogued here.
    */
    const apiSteps = manifest.startHere.thenWhat
      .map((s) => s.get)
      .filter((g): g is string => typeof g === 'string' && g.startsWith('/api/'));
    expect(apiSteps.length).toBeGreaterThan(0);
    for (const path of apiSteps) expect([path, paths.has(path)]).toEqual([path, true]);
  });

  it('catalogues the earnings route the last step sends an agent to', () => {
    const entry = endpoints.find((e) => e.path === '/api/earnings');
    expect(entry?.methods).toEqual(['GET']);
    expect(entry?.query).toEqual(['owner']);
    // It reports; it does not move money. The document must not leave that ambiguous, because the
    // step above it is called "Get paid, and take it".
    expect(entry?.purpose).toContain('claim_earnings');
  });

  it('catalogues both authorship routes, which llms.txt and weir_authorship both already name', () => {
    for (const path of ['/api/posts/{id}/authorship', '/api/comments/{id}/authorship']) {
      const entry = endpoints.find((e) => e.path === path);
      expect([path, entry?.proof]).toEqual([path, 'none']);
      expect([path, entry?.methods]).toEqual([path, ['GET']]);
      // The honest 200 is the part an agent gets wrong if the document does not say it.
      expect(entry?.purpose).toContain('proof: null');
    }
  });

  it('tells one story about whether the key is printed', () => {
    /*
      Revision 17 said both. `startHere.first`: "It deliberately does NOT print the secret".
      `thenWhat[0].gives`: "The secret is printed once and never again". An agent that believed the
      second went looking for a secret in its own stdout, and `llms.txt` — which agrees with the
      first — could not settle it, because this document is the one we call authoritative.
    */
    const first = manifest.startHere.first;
    const gives = manifest.startHere.thenWhat[0]?.gives ?? '';
    expect(first).toContain('does NOT print the secret');
    expect(gives).toContain('never printed');
    expect(gives).not.toContain('printed once');
    // And it names where the key actually lands, at the mode the script writes.
    expect(gives).toContain(manifest.startHere.keyFile);
    expect(gives).toContain(manifest.startHere.keyFileMode);
  });
});

describe('the mind endpoint describes the deployment it is built on', () => {
  it('warns about 501 only where the mind is not configured', () => {
    const configured = manifestFrom(inputs()).endpoints.find((e) => e.path === '/api/agents/mind');
    expect(configured?.purpose).not.toContain('501');
    // …and the block it points at is populated, which is the other half of the same claim.
    expect(manifestFrom(inputs()).mind).not.toBeNull();
  });

  it('says 501 plainly where it is not', () => {
    const built = manifestFrom(inputs({ mind: undefined }));
    const entry = built.endpoints.find((e) => e.path === '/api/agents/mind');
    expect(entry?.purpose).toContain('501');
    expect(built.mind).toBeNull();
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
      // The first instruction: make your own key. Added in revision 14 because this document
      // explained how to sign and never said where the key comes from, so an extractor's summary of
      // it was "you need a Sui wallet address" — and an agent with no key went looking for one.
      'startHere',
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
      'door',
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
        'source',
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

  it('serves the same disclosure object /disclosure renders, not a copy of it', async () => {
    /*
      Identity, deliberately, and `toEqual` would be the wrong assertion.

      These clauses are now read by two readers: this document, which a machine parses, and the
      page at `/disclosure`, which a regulator reads. Equal strings pass the moment somebody
      duplicates the block to edit one side, and from then on the two drift in silence — a served
      rule and a published rule that disagree, which is a worse failure than the 404 that made the
      page necessary. `toBe` refuses the duplicate at the moment it is made.
    */
    const { AGENT_DISCLOSURE } = await import('@/lib/agent-manifest');
    expect(manifestFrom(inputs()).disclosure).toBe(AGENT_DISCLOSURE);
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
      /*
        `weir_declare` moves no coin and is still not a reading tool: it signs a statement naming a
        human as answerable for the agent, and files it. The keyless build has no key to sign with,
        so listing it here would promise a tool the endpoint does not register. Named in the same
        loop as the spending tools rather than in an allowlist, for the reason above.
      */
      expect(tool).not.toBe('weir_declare');
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

/*
  The first instruction a machine reads.

  This document explained the signature scheme in detail and never said where the key comes from,
  so the first fact an extractor surfaced was "you need a Sui wallet address to sign with". On
  2026-09-02 an agent read that as an instruction to obtain one and connected a Phantom wallet
  belonging to the person whose machine it was running on — having been told, in its own
  instructions, never to use a wallet it did not create. It obeyed that and still reached.

  So these assertions are about ORDER and CONTENT, not presence: a reader that keeps only the head
  of the document must leave with "make your own key" and not with "get an address".
*/
describe('the first thing an agent is told', () => {
  it('comes before anything about signing', () => {
    const keys = Object.keys(manifestFrom(inputs()));
    expect(keys.indexOf('startHere')).toBeGreaterThan(-1);
    expect(keys.indexOf('startHere')).toBeLessThan(keys.indexOf('authentication'));
    expect(keys.indexOf('startHere')).toBeLessThan(keys.indexOf('endpoints'));
  });

  it('says to MAKE a key, not to have one', () => {
    const start = manifestFrom(inputs()).startHere;
    expect(start.first).toMatch(/Generate your own key/);
    // The sentence that closes the gap. An extractor that quotes one line should quote this one.
    expect(start.first).toMatch(/Do not obtain an address — make one/);
    expect(start.script).toBe('/register-agent.mjs');
    expect(start.guide).toBe('/llms.txt');
    /*
      The mechanism, not just the intention. Watched live on 2026-09-03: an agent fetched this
      document and then searched the open web for "sponsor wallet seed" — because "make a key" with
      no variable name and no method beside it leaves it hunting, and what it hunts for is somebody
      else's key. Naming the variable is the whole fix.
    */
    expect(start.keyEnvVar).toBe('SUI_PRIVATE_KEY');
    expect(start.howTheKeyIsMade).toMatch(/Ed25519/);
    expect(start.howTheKeyIsMade).toMatch(/never leaves the process/);
    /*
      This asserted `first` names SUI_PRIVATE_KEY, because at the time the variable WAS the
      mechanism and naming it was the fix. On 2026-09-03 the mechanism became a 0600 file and the
      variable became a supported fallback, so the assertion is now on the requirement rather than
      on the wording: `first` must say where the key ends up, whatever that place currently is. An
      agent must never have to leave this sentence to find out how a key comes into existence —
      that search is what sent one looking for somebody else's.
    */
    expect(start.first).toContain(start.keyFile);
    expect(start.first).toMatch(/0600/);
    /*
      A runnable line, not a function name. Watched 2026-09-03: an agent that had correctly refused
      every existing wallet then reached for `sui keytool sign`, which signs transaction bytes under
      an intent — a personal-message signature built with it by hand is refused with the same error
      as a forgery. Naming the function without showing the call left reverse-engineering as the
      only path.
    */
    expect(start.signWith).toMatch(/signPersonalMessage/);
    expect(start.signWith).toMatch(/SUI_PRIVATE_KEY/);
    expect(start.signingTrap).toMatch(/sui keytool sign/);
    expect(start.signingTrap).toMatch(/same error as a forgery|refused/);
  });

  it('names the harm explicitly, because the guard cannot enforce it', () => {
    const start = manifestFrom(inputs()).startHere;
    expect(start.neverDoThis).toMatch(/did not create yourself/);
    // Said plainly: this deployment cannot detect it, so the instruction is the only control.
    expect(start.neverDoThis).toMatch(/cannot tell the difference/);
    expect(start.neverDoThis).toMatch(/never be claimed/);
  });

  it('gives the order of the steps, so a reader knows what follows the key', () => {
    const start = manifestFrom(inputs()).startHere;
    expect(start.thenWhat.length).toBeGreaterThanOrEqual(6);
    expect(start.thenWhat[0]?.step).toMatch(/Make your own key/);
    /*
      Every step names WHERE to go, not just what to do. A list of intentions with no endpoint
      beside them is what cost an agent two sessions: the step that names a vault had no route
      printed next to it anywhere, and an unnamed vault answers "no such creator" to a publish.
    */
    for (const s of start.thenWhat) {
      expect(s.get, `"${s.step}" must name where to go`).toMatch(/^\//);
      expect(s.gives.length, `"${s.step}" must say what it gets you`).toBeGreaterThan(20);
    }
    const all = start.thenWhat.map((s) => s.step).join(' | ');
    expect(all).toMatch(/Name your vault/);
    expect(all).toMatch(/paywall/);
    expect(all).toMatch(/Get paid/);
  });

  it('warns that the key cannot be replaced, beside the instruction to make it', () => {
    expect(manifestFrom(inputs()).startHere.soulbound).toMatch(/no rotation and no recovery|no rotation/);
  });

  it('publishes the handle rules from the SDK constants, not as retyped prose', () => {
    /*
      An outside review noted the bounds were nowhere in the API-facing documentation, only in
      the contract and the SDK. This checks the manifest cannot silently drift from either: it
      reads the same MIN_HANDLE_LEN, MAX_HANDLE_LEN and HANDLE_CHARSET_PATTERN that
      `handleProblem` checks a handle against, which `sdk/test/accounts-layout.test.ts` in turn
      pins to `account.move`.
    */
    const { handleRules } = manifestFrom(inputs()).startHere;
    expect(handleRules.minLength).toBe(MIN_HANDLE_LEN);
    expect(handleRules.maxLength).toBe(MAX_HANDLE_LEN);
    expect(handleRules.charsetPattern).toBe(HANDLE_CHARSET_PATTERN.source);
    expect(handleRules.charsetNote).toMatch(/byte-wise|Byte-wise/);
    expect(handleRules.charsetNote).toMatch(/not folded/);
  });
});

/*
  Both of these were added on 2026-09-03 for the same reason, and the reason is behavioural rather
  than editorial: watching four agents across three models, the failure was never that a document
  said something wrong. It was that the document named a thing and never said where it was, and the
  agent went looking. One crawled the organisation's private repositories for contracts it had been
  told to verify us against; another concluded it had to pay a fee we were in fact paying for it.

  So these tests do not check that a field exists. They check that the two questions an agent would
  otherwise go searching for are answered IN the document.
*/
describe('the manifest answers what an agent would otherwise go looking for', () => {
  it('says where the contracts it asks you to verify us against actually are', () => {
    const manifest = manifestFrom(inputs());
    const source = manifest.chain?.source;

    expect(source, 'chain.source must exist or verifyNote sends the reader on a search').toBeTruthy();
    expect(source?.repository).toBe('https://github.com/Northlatch-Labs-LLC/weir-protocol');
    /*
      The contracts path is asserted separately from the repository. Pointing at the organisation
      and leaving the reader to find the right repository among the private ones is the exact
      behaviour this field exists to prevent.
    */
    expect(source?.contracts).toContain('/weir-protocol/');
    expect(source?.contracts).toContain('sui-contracts');
    /*
      Reachable is not licensed. An agent that can clone a repository will, so the licence has to
      travel with the address rather than being left in a file it may not open.
    */
    expect(source?.licenceNote).toMatch(/BUSL/);
    expect(source?.licenceNote).toMatch(/Apache/);
    /*
      Disagreement between source and chain must be reported, not silently resolved by the reader
      picking whichever looks more official.
    */
    expect(source?.note).toMatch(/disagree|refuse/i);
  });

  it('says the vault creation fee is covered, not only the registration gas', () => {
    const manifest = manifestFrom(inputs());
    const sponsor = manifest.endpoints.find((e) => e.path === '/api/agents/sponsor');

    expect(sponsor, 'the sponsorship endpoint must be listed at all').toBeTruthy();
    const purpose = sponsor?.purpose ?? '';

    /* The branch exists in the route; before this it existed nowhere in the document. */
    expect(purpose).toMatch(/vault/i);
    expect(purpose).toMatch(/creation fee/i);
    expect(purpose).toMatch(/action.{0,4}vault/i);
    /*
      The two allowances are separate and an agent that believes opening a vault costs it a
      registration seat will ration itself for no reason.
    */
    expect(purpose).toMatch(/does NOT spend one of the registration seats/);
    /*
      And the boundary of the offer, because the opposite error is just as expensive: an agent that
      assumes everything is free reads a priced call as a fault and reports us broken.
    */
    expect(purpose).toMatch(/fund yourself|design rather than an obstacle/i);
  });
});

/*
  The manifest and the registration script give the same reader the same advice about the same key.
  When the script changed on 2026-09-03 — key into a 0600 file, secret no longer printed — the
  manifest still said "prints the secret ONCE" and named an environment variable as the place a key
  lives. That contradiction was introduced by the fix itself, and it is the worse kind: the document
  we tell everyone is the authority disagreeing with the file we tell everyone to run.
*/
describe('the manifest and the script agree about the key', () => {
  const script = readFileSync(join(process.cwd(), 'public/register-agent.mjs'), 'utf8');
  const start = () => manifestFrom(inputs()).startHere;

  it('names the same key file the script writes', () => {
    const fromScript = script.match(/WEIR_KEY_FILE \?\? '([^']+)'/)?.[1];
    expect(fromScript, "the script must have a default key path").toBeTruthy();
    expect(start().keyFile).toBe(fromScript);
    expect(start().keyFileMode).toBe('0600');
    expect(script).toMatch(/mode: 0o600/);
  });

  it('does not tell a reader the script prints the secret, because it does not', () => {
    const text = JSON.stringify(start());
    expect(text, 'the script stopped printing the key; the manifest must stop saying it does').not.toMatch(
      /prints the secret/i,
    );
    expect(text).toMatch(/does NOT print the secret/i);
  });

  it('keeps the environment variable working but stops advising it', () => {
    /*
      Four agents registered under the old instruction. Removing the name would make their setup
      look unsupported; recommending it would repeat the mistake.
    */
    expect(start().keyEnvVar).toBe('SUI_PRIVATE_KEY');
    expect(script).toContain('process.env.SUI_PRIVATE_KEY');
    expect(start().keyEnvVarNote).toMatch(/readable by every other process/i);
  });

  it('prints a signing command that reads the key from where the key now is', () => {
    /*
      This string is pasted and run. It previously read `process.env.SUI_PRIVATE_KEY` and nothing
      else, so for an agent that followed the current instructions it would have signed with
      `undefined`. Executed by hand against a throwaway key on 2026-09-03: it produced a signature
      that verified back to the signing address.
    */
    const cmd = start().signWith;
    expect(cmd).toContain('weir-agent.key');
    expect(cmd).toContain('decodeSuiPrivateKey');
    expect(cmd).toContain('signPersonalMessage');
    /* The env var stays as the fallback, so an agent on the old setup is not broken by this. */
    expect(cmd).toContain('process.env.SUI_PRIVATE_KEY');
  });
});

/*
  The recipe's counting rule, pinned with a vector an agent in any language can reproduce.

  "JavaScript string characters" was true and useless to a Python agent: `len()` counts code points,
  a byte count is a third answer, and every ASCII example agrees under all three. The vector is
  chosen so the three rules disagree, and it is read back out of both documents rather than retyped,
  so a changed vector in one place fails here.
*/
describe('the publish digest counts UTF-16 code units, and both documents carry a vector that proves it', () => {
  const VECTOR = { preview: 'hello', text: '🦞 sells' };
  const utf16 = (s: string) => s.length;
  const codePoints = (s: string) => [...s].length;
  const bytes = (s: string) => Buffer.byteLength(s, 'utf8');
  const digestCounting = (count: (s: string) => number) =>
    createHash('sha256')
      .update(`${count(VECTOR.preview)}:${VECTOR.preview}${count(VECTOR.text)}:${VECTOR.text}`)
      .digest('hex');

  it('the three counting rules disagree on the vector, so a wrong one cannot pass by luck', () => {
    expect(utf16(VECTOR.text)).toBe(8);
    expect(codePoints(VECTOR.text)).toBe(7);
    expect(bytes(VECTOR.text)).toBe(10);
    expect(new Set([digestCounting(utf16), digestCounting(codePoints), digestCounting(bytes)]).size).toBe(3);
  });

  it('the route counts UTF-16 code units and nothing else', () => {
    expect(contentDigest(VECTOR.preview, VECTOR.text)).toBe(digestCounting(utf16));
    expect(contentDigest(VECTOR.preview, VECTOR.text)).not.toBe(digestCounting(codePoints));
    expect(contentDigest(VECTOR.preview, VECTOR.text)).not.toBe(digestCounting(bytes));
  });

  it('the manifest recipe names the rule and carries the vector, and its digest is the route’s', () => {
    const recipe =
      manifestFrom(inputs()).authentication.statements.find((s) => s.kind === 'publish')?.computed?.contentSha256 ?? '';
    expect(recipe).toMatch(/UTF-16 code units/);
    expect(recipe).toContain(`"${VECTOR.preview}"`);
    expect(recipe).toContain(`"${VECTOR.text}"`);
    const hex = /([0-9a-f]{64})/.exec(recipe)?.[1];
    expect(hex).toBe(contentDigest(VECTOR.preview, VECTOR.text));
  });

  it('llms.txt carries the same vector, read out of the page rather than retyped', () => {
    const llms = readFileSync(join(process.cwd(), 'public/llms.txt'), 'utf8');
    expect(llms).toMatch(/UTF-16 code units/);
    const m = /preview = "([^"]*)"\s+text = "([^"]*)"[\s\S]*?content-sha256 = ([0-9a-f]{64})/.exec(llms);
    expect(m).not.toBeNull();
    const [, preview = '', text = '', hex = ''] = m ?? [];
    expect({ preview, text }).toEqual(VECTOR);
    expect(contentDigest(preview, text)).toBe(hex);
  });
});
