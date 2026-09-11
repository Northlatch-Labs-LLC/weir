// @vitest-environment node
// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>

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

const STATEMENTS_SOURCE = '../sdk/src/statements.ts';

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
    door: { peopleGated: true, peopleOnboardFrom: { atMs: 1_796_083_200_000, label: 'people onboard from' } },
    custody: ok({
      upgradeCap: { objectId: `0x${'0a'.repeat(32)}`, holder: ok(`0x${'0b'.repeat(32)}`) },
      platformCap: { objectId: `0x${'0c'.repeat(32)}`, holder: ok(`0x${'0b'.repeat(32)}`) },
    }),
    ...overrides,
  };
}

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
    const templates = sourceTemplates();
    expect(templates.size).toBeGreaterThan(10);
    const withheld = new Set<string>(UNPUBLISHED_ACTION_KINDS);
    expect([...new Set(statements.map((s) => s.kind))].sort()).toEqual(
      [...templates.keys()].filter((k) => !withheld.has(k)).sort(),
    );
  });

  it('withholds only kinds the verifier actually has, and withholds at least one deliberately', () => {
    const templates = sourceTemplates();
    for (const kind of UNPUBLISHED_ACTION_KINDS) {
      expect([kind, templates.has(kind)]).toEqual([kind, true]);
    }
    expect(UNPUBLISHED_ACTION_KINDS.length).toBeLessThan(templates.size);
  });

  it('publishes no statement that names a wallet to fund, because payment settles on chain', () => {
    expect(statements.map((s) => s.kind)).not.toContain('onramp');
    for (const s of statements) expect(s.statement).not.toContain('action: fund wallet');
  });

  it('publishes both forms of every statement that prints a word instead of a slot', () => {
    const variants = (kind: string): string[] =>
      statements.filter((s) => s.kind === kind).map((s) => s.variant);
    expect(variants('follow')).toEqual(['following=false', 'following=true']);
    expect(variants('set-perks')).toEqual(['supportersFirst=false', 'supportersFirst=true']);
    expect(statements.filter((s) => s.kind === 'comment')).toHaveLength(1);
  });

  it('publishes exactly what `statementFor` builds, character for character', () => {
    const templates = sourceTemplates();
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
      expect(statement.statement).not.toMatch(/999999999/);
    }
  });

  it('marks every statement single-use except the ones identity.ts exempts', () => {
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

  const fileFor = (path: string): string =>
    `app${path.replaceAll('{', '[').replaceAll('}', ']')}/route.ts`;

  it('names a route handler that exists, for every path', () => {
    for (const endpoint of endpoints) {
      expect(() => read(fileFor(endpoint.path))).not.toThrow();
    }
  });

  it('says content-price answers for the machine edition too, and the route does', () => {
    const entry = endpoints.find((e) => e.path === '/api/studio/content-price');
    expect(entry?.purpose).toContain('machineBody');
    for (const state of ['sealed', 'no-post', 'absent']) expect(entry?.purpose).toContain(state);
    const source = read(fileFor('/api/studio/content-price'));
    expect(source).toContain('machineBodyState(');
    expect(source).toContain('machineBody,');
  });

  it('puts this document at the path the manifest says it lives at', () => {
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
    for (const endpoint of endpoints) {
      const source = read(fileFor(endpoint.path));
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
    expect(entry?.purpose).toContain('claim_earnings');
  });

  it('catalogues both authorship routes, which llms.txt and weir_authorship both already name', () => {
    for (const path of ['/api/posts/{id}/authorship', '/api/comments/{id}/authorship']) {
      const entry = endpoints.find((e) => e.path === path);
      expect([path, entry?.proof]).toEqual([path, 'none']);
      expect([path, entry?.methods]).toEqual([path, ['GET']]);
      expect(entry?.purpose).toContain('proof: null');
    }
  });

  it('tells one story about whether the key is printed', () => {
    const first = manifest.startHere.first;
    const gives = manifest.startHere.thenWhat[0]?.gives ?? '';
    expect(first).toContain('does NOT print the secret');
    expect(gives).toContain('never printed');
    expect(gives).not.toContain('printed once');
    expect(gives).toContain(manifest.startHere.keyFile);
    expect(gives).toContain(manifest.startHere.keyFileMode);
  });
});

describe('the mind endpoint describes the deployment it is built on', () => {
  it('warns about 501 only where the mind is not configured', () => {
    const configured = manifestFrom(inputs()).endpoints.find((e) => e.path === '/api/agents/mind');
    expect(configured?.purpose).not.toContain('501');
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
    const manifest = manifestFrom(inputs());
    const required = [
      'manifest',
      'version',
      'integrity',
      'service',
      'origin',
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
    expect(serialised).toContain(SEAL.keyServers[0]?.objectId ?? 'missing');
  });

  it('reports amounts as strings, because a bigint fee is not a JSON number', () => {
    const manifest = manifestFrom(inputs());
    expect(manifest.money?.platform?.feeBps).toBe('290');
    expect(manifest.money?.platform?.creationFeeMist).toBe('29000000000');
    expect(manifest.money?.platform?.readFrom).toBe(CONFIG.platformId);
  });

  it('says the platform could not be read rather than printing a zero fee', () => {
    const manifest = manifestFrom(
      inputs({ platform: fail('transport', 'Platform', 'the node did not answer') }),
    );
    expect(manifest.money?.platform).toBeNull();
    expect(manifest.money?.platformUnavailable).toContain('did not answer');
    expect(JSON.stringify(manifest.money)).not.toContain('"feeBps"');
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
    expect(session.returns).toEqual(['address', 'expiresAtMs']);
    expect(session.bearerHeader.adds).toBe('token');
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
    const terms = read('content/legal/terms.md');
    expect(terms).toContain('access it by automated means except through documented public APIs');
    expect(terms).toContain('impersonate any person or entity');
    const manifest = manifestFrom(inputs());
    expect(manifest.disclosure.basis).toContain('6(d)');
    expect(manifest.disclosure.basis).toContain('6(g)');
    expect(manifest.disclosure.notEnforced).not.toBe('');
  });

  it('serves the same disclosure object /disclosure renders, not a copy of it', async () => {
    const { AGENT_DISCLOSURE } = await import('@/lib/agent-manifest');
    expect(manifestFrom(inputs()).disclosure).toBe(AGENT_DISCLOSURE);
  });
});

describe('the hosted MCP section', () => {
  it('names an https endpoint and only reading tools', () => {
    const manifest = manifestFrom(inputs());
    expect(manifest.mcp.hosted.startsWith('https://')).toBe(true);
    expect(manifest.mcp.mode).toBe('read-only');
    expect(manifest.mcp.tools.length).toBeGreaterThan(0);
    for (const tool of manifest.mcp.tools) {
      expect(tool.startsWith('weir_')).toBe(true);
      expect(['weir_buy', 'weir_subscribe', 'weir_post', 'weir_send', 'weir_price']).not.toContain(tool);
      expect(tool).not.toBe('weir_balance');
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

describe('the publish digest recipe', () => {
  const digestAsDocumented = (preview: string, text: string) =>
    createHash('sha256').update(`${preview.length}:${preview}${text.length}:${text}`).digest('hex');

  it('is published on the publish statement, and nowhere else', () => {
    const manifest = manifestFrom(inputs());
    const publish = manifest.authentication.statements.filter((s) => s.kind === 'publish');
    expect(publish.length).toBeGreaterThan(0);
    for (const s of publish) expect(s.computed?.contentSha256).toBeTruthy();
    for (const s of manifest.authentication.statements.filter((s) => s.kind !== 'publish')) {
      expect(s.computed).toBeUndefined();
    }
  });

  it('describes what the deployment actually computes', () => {
    const manifest = manifestFrom(inputs());
    const recipe =
      manifest.authentication.statements.find((s) => s.kind === 'publish')?.computed?.contentSha256 ?? '';
    expect(recipe).toMatch(/preview\.length/);
    expect(recipe).toMatch(/text\.length/);
    expect(recipe).toMatch(/NOT sha256 of the text/);
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
    expect(start.first).toMatch(/Do not obtain an address — make one/);
    expect(start.script).toBe('/register-agent.mjs');
    expect(start.guide).toBe('/llms.txt');
    expect(start.keyEnvVar).toBe('SUI_PRIVATE_KEY');
    expect(start.howTheKeyIsMade).toMatch(/Ed25519/);
    expect(start.howTheKeyIsMade).toMatch(/never leaves the process/);
    expect(start.first).toContain(start.keyFile);
    expect(start.first).toMatch(/0600/);
    expect(start.signWith).toMatch(/signPersonalMessage/);
    expect(start.signWith).toMatch(/SUI_PRIVATE_KEY/);
    expect(start.signingTrap).toMatch(/sui keytool sign/);
    expect(start.signingTrap).toMatch(/same error as a forgery|refused/);
  });

  it('names the harm explicitly, because the guard cannot enforce it', () => {
    const start = manifestFrom(inputs()).startHere;
    expect(start.neverDoThis).toMatch(/did not create yourself/);
    expect(start.neverDoThis).toMatch(/cannot tell the difference/);
    expect(start.neverDoThis).toMatch(/never be claimed/);
  });

  it('gives the order of the steps, so a reader knows what follows the key', () => {
    const start = manifestFrom(inputs()).startHere;
    expect(start.thenWhat.length).toBeGreaterThanOrEqual(6);
    expect(start.thenWhat[0]?.step).toMatch(/Make your own key/);
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
    const { handleRules } = manifestFrom(inputs()).startHere;
    expect(handleRules.minLength).toBe(MIN_HANDLE_LEN);
    expect(handleRules.maxLength).toBe(MAX_HANDLE_LEN);
    expect(handleRules.charsetPattern).toBe(HANDLE_CHARSET_PATTERN.source);
    expect(handleRules.charsetNote).toMatch(/byte-wise|Byte-wise/);
    expect(handleRules.charsetNote).toMatch(/not folded/);
  });
});

describe('the manifest answers what an agent would otherwise go looking for', () => {
  it('says where the contracts it asks you to verify us against actually are', () => {
    const manifest = manifestFrom(inputs());
    const source = manifest.chain?.source;

    expect(source, 'chain.source must exist or verifyNote sends the reader on a search').toBeTruthy();
    expect(source?.repository).toBe('https://github.com/Northlatch-Labs-LLC/weir-protocol');
    expect(source?.contracts).toContain('/weir-protocol/');
    expect(source?.contracts).toContain('sui-contracts');
    expect(source?.licenceNote).toMatch(/BUSL/);
    expect(source?.licenceNote).toMatch(/Apache/);
    expect(source?.note).toMatch(/disagree|refuse/i);
  });

  it('says the vault creation fee is covered, not only the registration gas', () => {
    const manifest = manifestFrom(inputs());
    const sponsor = manifest.endpoints.find((e) => e.path === '/api/agents/sponsor');

    expect(sponsor, 'the sponsorship endpoint must be listed at all').toBeTruthy();
    const purpose = sponsor?.purpose ?? '';

    expect(purpose).toMatch(/vault/i);
    expect(purpose).toMatch(/creation fee/i);
    expect(purpose).toMatch(/action.{0,4}vault/i);
    expect(purpose).toMatch(/does NOT spend one of the registration seats/);
    expect(purpose).toMatch(/fund yourself|design rather than an obstacle/i);
  });
});

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
    expect(start().keyEnvVar).toBe('SUI_PRIVATE_KEY');
    expect(script).toContain('process.env.SUI_PRIVATE_KEY');
    expect(start().keyEnvVarNote).toMatch(/readable by every other process/i);
  });

  it('prints a signing command that reads the key from where the key now is', () => {
    const cmd = start().signWith;
    expect(cmd).toContain('weir-agent.key');
    expect(cmd).toContain('decodeSuiPrivateKey');
    expect(cmd).toContain('signPersonalMessage');
    expect(cmd).toContain('process.env.SUI_PRIVATE_KEY');
  });
});

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
