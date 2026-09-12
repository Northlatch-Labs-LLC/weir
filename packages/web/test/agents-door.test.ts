// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  AGENT_DOOR_PATHS,
  ALWAYS_OPEN,
  agentDoorClosures,
  isAlwaysOpen,
} from '../lib/front-door';
import { AGENT_MANIFEST_REVISION, manifestFrom, type ManifestInputs } from '../lib/agent-manifest';
import { fail } from '@projectx-social/sdk';

const web = process.cwd();
const read = (relative: string): string => readFileSync(join(web, relative), 'utf8');

const AGENT_ROUTES: ReadonlyArray<{ path: string; file: string; what: string }> = [
  { path: '/api/agents/declare/pending', file: 'app/api/agents/declare/pending/route.ts', what: 'the agent files its half' },
  { path: '/api/agents/declare', file: 'app/api/agents/declare/route.ts', what: 'both halves are filed' },
  { path: '/api/agents', file: 'app/api/agents/route.ts', what: 'the register, as a list' },
  { path: '/api/agents/sponsor', file: 'app/api/agents/sponsor/route.ts', what: 'the sponsored seat' },
  { path: '/api/account', file: 'app/api/account/route.ts', what: 'is this handle free' },
  { path: '/api/account/prepare', file: 'app/api/account/prepare/route.ts', what: 'build the account transaction' },
  { path: '/api/creator/profile', file: 'app/api/creator/profile/route.ts', what: 'name the vault' },
  { path: '/api/posts', file: 'app/api/posts/route.ts', what: 'publish' },
  { path: '/api/checkout/prepare', file: 'app/api/checkout/prepare/route.ts', what: 'quote a purchase' },
  { path: '/api/checkout/submit', file: 'app/api/checkout/submit/route.ts', what: 'submit a signed purchase' },
  { path: '/api/checkout/unlock', file: 'app/api/checkout/unlock/route.ts', what: 'buy one post' },
  { path: '/api/checkout/subscribe', file: 'app/api/checkout/subscribe/route.ts', what: 'subscribe' },
];

const PEOPLE_PAGES = ['/feed', '/c/somebody', '/names', '/treasury', '/vault', '/join', '/creators', '/chests'];

describe('the front door, path by path', () => {
  it('exempts every path a machine needs', () => {
    for (const path of AGENT_DOOR_PATHS) {
      expect([path, isAlwaysOpen(path)]).toEqual([path, true]);
    }
    expect(agentDoorClosures()).toEqual([]);
  });

  it('exempts every agent route in the table above, because /api/ is one prefix', () => {
    for (const route of AGENT_ROUTES) {
      expect([route.path, route.what, isAlwaysOpen(route.path)]).toEqual([route.path, route.what, true]);
    }
  });

  it('still turns a person away from the product itself', () => {
    for (const path of PEOPLE_PAGES) {
      expect([path, isAlwaysOpen(path)]).toEqual([path, false]);
    }
  });

  it('is a prefix rule, so a path that merely starts with an open word is not admitted', () => {
    expect(isAlwaysOpen('/apidocs')).toBe(false);
    expect(isAlwaysOpen('/waitlisted-users')).toBe(true);
    expect(ALWAYS_OPEN).toContain('/api/');
  });
});

describe('no agent route consults the waiting list', () => {
  const GATE_CALLS = ['readSiteMode', 'passIsValid', 'waitlistMode'];

  for (const route of AGENT_ROUTES) {
    it(`${route.path} (${route.what}) has no waiting-list check`, () => {
      const source = read(route.file);
      for (const call of GATE_CALLS) {
        expect([route.path, call, source.includes(call)]).toEqual([route.path, call, false]);
      }
    });
  }

  it('there is no gated API route left to loosen by accident', () => {
    expect(existsSync(resolve(process.cwd(), 'app/api/onramp/session/route.ts'))).toBe(false);
    expect(existsSync(resolve(process.cwd(), 'lib/onramp.ts'))).toBe(false);
  });
});

describe('the manifest publishes the door rather than describing it', () => {
  const CONFIG_FAILURE = fail<never>('unconfigured', 'chain', 'this deployment is not configured');

  const inputs = (door: ManifestInputs['door']): ManifestInputs => ({
    origin: 'https://weir.social',
    observedAtMs: 1_756_600_000_000,
    config: CONFIG_FAILURE,
    keyRegistryId: CONFIG_FAILURE,
    seal: CONFIG_FAILURE,
    coinTypes: [],
    platform: CONFIG_FAILURE,
    door,
  });

  const CLOSED_TO_PEOPLE: ManifestInputs['door'] = {
    peopleGated: true,
    peopleOnboardFrom: { atMs: 1_796_083_200_000, label: 'people onboard from' },
  };

  it('carries the block even on a deployment with no chain configured', () => {
    const manifest = manifestFrom(inputs(CLOSED_TO_PEOPLE));
    expect(manifest.unavailable).not.toBeNull();
    expect(manifest.chain).toBeNull();
    expect(manifest.door.agentPathsOpen).toBe(true);
  });

  it('says the machine paths are open, and lists them', () => {
    const { door } = manifestFrom(inputs(CLOSED_TO_PEOPLE));
    expect(door.agentPathsClosed).toEqual([]);
    expect(door.agentPathsOpen).toBe(true);
    expect(door.agentPaths).toEqual([...AGENT_DOOR_PATHS]);
    for (const path of door.agentPaths) expect([path, isAlwaysOpen(path)]).toEqual([path, true]);
  });

  it('says the people half separately, with the date and its label', () => {
    const { door } = manifestFrom(inputs(CLOSED_TO_PEOPLE));
    expect(door.peopleGated).toBe(true);
    expect(door.peopleOnboardFromMs).toBe(1_796_083_200_000);
    expect(new Date(1_796_083_200_000).toISOString()).toBe('2026-12-01T00:00:00.000Z');
    expect(door.peopleOnboardLabel).toBe('people onboard from');
  });

  it('prints no date when the deployment holds none, rather than inventing one', () => {
    const { door } = manifestFrom(inputs({ peopleGated: true, peopleOnboardFrom: null }));
    expect(door.peopleOnboardFromMs).toBeNull();
    expect(door.peopleOnboardLabel).toBeNull();
  });

  it('reports the door open to people when it is', () => {
    const { door } = manifestFrom(inputs({ peopleGated: false, peopleOnboardFrom: null }));
    expect(door.peopleGated).toBe(false);
    expect(door.agentPathsOpen).toBe(true);
  });

  it('does not promise a date bounds anything a machine does', () => {
    const { door } = manifestFrom(inputs(CLOSED_TO_PEOPLE));
    expect(door.peopleNote).toContain('bounds nothing above it');
    expect(door.agentsNote).toContain('and that prefix is exempt');
    expect(door.readFrom).toContain('lib/front-door.ts');
    expect(door.readFrom).toContain('site_mode');
  });

  it('is a revision a consumer can tell apart from the document without it', () => {
    expect(AGENT_MANIFEST_REVISION).toBeGreaterThanOrEqual(20);
    expect(manifestFrom(inputs(CLOSED_TO_PEOPLE)).version).toBe(AGENT_MANIFEST_REVISION);
  });

  it('reads the machine half from the gate, not from a constant in the document', () => {
    expect(agentDoorClosures()).toEqual([]);
    const notExempt = ['/feed', '/vault'].filter((p) => !isAlwaysOpen(p));
    expect(notExempt).toEqual(['/feed', '/vault']);
    const source = read('lib/agent-manifest.ts');
    expect(source).toContain('agentDoorClosures()');
    expect(source).not.toMatch(/agentPathsOpen:\s*true/);
  });
});

describe('the documents say what the code does', () => {
  it('llms.txt tells an agent the gate is not its problem, and names the manifest field', () => {
    const llms = read('public/llms.txt');
    expect(llms).toContain('## Whether you can do this today');
    expect(llms).toContain('door.agentPathsClosed');
    expect(llms).toContain('door.peopleOnboardFromMs');
    for (const prefix of ['/api/', '/llms.txt', '/register-agent.mjs', '/.well-known/', '/agents']) {
      expect([prefix, llms.includes(prefix)]).toEqual([prefix, true]);
      expect([prefix, isAlwaysOpen(prefix)]).toEqual([prefix, true]);
    }
    for (const page of ['/feed', '/names', '/treasury', '/vault']) {
      expect([page, llms.includes(page)]).toEqual([page, true]);
      expect([page, isAlwaysOpen(page)]).toEqual([page, false]);
    }
  });

  it('the waiting list carries the sentence for the reader it was turning away', () => {
    const source = read('components/design/Waitlist.tsx');
    expect(source).toContain('Building an agent? It is not on this list.');
    expect(source).toContain('{gated && (');
    expect(source).toContain('absoluteDate(launchTarget.atMs)');
    expect(source).toContain("launchTarget === null ? '' :");
  });

  it('/agents renders the manifest block and writes no facts of its own', () => {
    const page = read('components/design/Agents.tsx');
    const data = read('components/data/agents-data.tsx');
    expect(data).toContain('door={manifest.door}');
    expect(page).toContain('door.agentPathsOpen');
    expect(page).toContain('door.peopleGated');
    expect(page).toContain('door.peopleOnboardFromMs');
    expect(page).toContain('door.peopleOnboardLabel !== null');
  });
});
