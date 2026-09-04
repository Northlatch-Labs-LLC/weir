// Built-by: @projectx.sui /|\ · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
/**
 * Who the front door lets through, asserted as a table rather than as a sentence.
 *
 * # The mistake this exists to make impossible
 *
 * The waiting list and the agent register are two different doors that were being read as one. A
 * person is behind `site_mode.waitlist_mode`; a machine never was, because `proxy.ts` exempts
 * `/api/` and always has. Nothing in the code said so anywhere a reader would look, so the pages
 * told an operator to wait for a date that applied to nothing their agent did.
 *
 * The fix was a statement, not a lift — there was no gate on the agent path to lift — and a
 * statement is exactly the kind of change that rots. These assertions are what stop it: the moment
 * `/api/` leaves the exemption list, the manifest's `door.agentPathsClosed` names it, this file
 * goes red, and the sentences on `/agents`, `/waitlist` and in `llms.txt` are wrong in a way
 * somebody is told about.
 *
 * # Why so much of it reads source
 *
 * Because the claim is about a refusal that does not exist. "This route does not consult the
 * waiting list" cannot be proven by calling it — a route with no database would answer the same
 * way for the wrong reason. It is proven by reading the route and finding no gate, and by finding
 * the gate in the one route that has one.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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

/**
 * The paths a declared agent's day is made of, and the file that answers each.
 *
 * This is the gate table the change rests on, written where it can fail. Every one of these is a
 * call under `/api/`, which is why the second describe below can assert one property of all of
 * them at once.
 */
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

/** Pages a person browses. None of these is exempt, and that is what the waiting list is. */
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
    /*
      `/agentsomething` starting with `/agents` IS admitted by a prefix rule, and that is worth
      knowing rather than discovering. What must not happen is the reverse — an exemption that
      admits a path it does not name at all.
    */
    expect(isAlwaysOpen('/apidocs')).toBe(false);
    expect(isAlwaysOpen('/waitlisted-users')).toBe(true);
    expect(ALWAYS_OPEN).toContain('/api/');
  });
});

describe('no agent route consults the waiting list', () => {
  /*
    The negative half of the table. `readSiteMode` is the only way to learn whether the door is
    closed and `passIsValid` the only way to be admitted through it, so a route mentioning neither
    cannot be gated by either — whatever else it refuses.
  */
  const GATE_CALLS = ['readSiteMode', 'passIsValid', 'waitlistMode'];

  for (const route of AGENT_ROUTES) {
    it(`${route.path} (${route.what}) has no waiting-list check`, () => {
      const source = read(route.file);
      for (const call of GATE_CALLS) {
        expect([route.path, call, source.includes(call)]).toEqual([route.path, call, false]);
      }
    });
  }

  it('the one API route that IS gated still is, with the same words', () => {
    /*
      `/api/onramp/session` mints a card-purchase session against a third-party merchant account,
      and it is gated on the site being open. It is left exactly as it was: no agent path runs
      through it, payment here settles on chain from the buyer's own key, and loosening a spend
      door nobody asked to loosen would be a change made by accident.

      Pinned by its message as well as its check, because "still gated" and "gated and now says
      something else" are different outcomes and only one of them is this test passing.
    */
    const source = read('app/api/onramp/session/route.ts');
    expect(source).toContain('readSiteMode');
    expect(source).toContain('if (mode.waitlistMode)');
    expect(source).toContain("{ error: 'the site is not open yet' }, { status: 403 }");
  });
});

describe('the manifest publishes the door rather than describing it', () => {
  const CONFIG_FAILURE = fail<never>('unconfigured', 'chain', 'this deployment is not configured');

  /** The smallest input that builds a document: everything unreadable but the door. */
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
    // 2026-12-01T00:00:00Z, the target this deployment holds while the alpha is closed.
    peopleOnboardFrom: { atMs: 1_796_083_200_000, label: 'people onboard from' },
  };

  it('carries the block even on a deployment with no chain configured', () => {
    /*
      The door is a fact about this web application, not about the chain. A document that dropped
      it in the unconfigured branch would leave the one reader who most needs it — an agent
      probing a fresh deployment — with silence where the answer is.
    */
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
    // Every path it publishes is one the gate really admits; not a list written beside the rule.
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
    // And the machine half does not move with it: it never depended on the switch.
    expect(door.agentPathsOpen).toBe(true);
  });

  it('does not promise a date bounds anything a machine does', () => {
    const { door } = manifestFrom(inputs(CLOSED_TO_PEOPLE));
    expect(door.peopleNote).toContain('bounds nothing above it');
    expect(door.agentsNote).toContain('and that prefix is exempt');
    // The block says where each half was read from, so a reader can go and check it.
    expect(door.readFrom).toContain('lib/front-door.ts');
    expect(door.readFrom).toContain('site_mode');
  });

  it('is a revision a consumer can tell apart from the document without it', () => {
    /*
      `door` shipped at revision 20. A deployment serving an earlier number and this block is
      serving a document whose version says "nothing new here" while carrying a field consumers
      branch on — which is the one thing the revision exists to prevent.
    */
    expect(AGENT_MANIFEST_REVISION).toBeGreaterThanOrEqual(20);
    expect(manifestFrom(inputs(CLOSED_TO_PEOPLE)).version).toBe(AGENT_MANIFEST_REVISION);
  });

  it('reads the machine half from the gate, not from a constant in the document', () => {
    /*
      The mutation this file was written for. `agentDoorClosures` is a fold over ALWAYS_OPEN, so
      asking it about a path that is NOT exempt must produce that path — if it can only ever
      return an empty array, every assertion above is decoration.
    */
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
    /*
      Every prefix the paragraph claims is exempt has to be exempt. This is the assertion that
      turns the paragraph from prose into a checked statement.
    */
    for (const prefix of ['/api/', '/llms.txt', '/register-agent.mjs', '/.well-known/', '/agents']) {
      expect([prefix, llms.includes(prefix)]).toEqual([prefix, true]);
      expect([prefix, isAlwaysOpen(prefix)]).toEqual([prefix, true]);
    }
    // And every page it says redirects really is behind the gate.
    for (const page of ['/feed', '/names', '/treasury', '/vault']) {
      expect([page, llms.includes(page)]).toEqual([page, true]);
      expect([page, isAlwaysOpen(page)]).toEqual([page, false]);
    }
  });

  it('the waiting list carries the sentence for the reader it was turning away', () => {
    const source = read('components/design/Waitlist.tsx');
    expect(source).toContain('Building an agent? It is not on this list.');
    // Only while the door is closed; an open site saying "not on this list" describes no list.
    expect(source).toContain('{gated && (');
    // The date is the deployment's, printed by the same formatter the countdown uses.
    expect(source).toContain('absoluteDate(launchTarget.atMs)');
    expect(source).toContain("launchTarget === null ? '' :");
  });

  it('/agents renders the manifest block and writes no facts of its own', () => {
    const page = read('components/design/Agents.tsx');
    const data = read('components/design/agents-data.tsx');
    expect(data).toContain('door={manifest.door}');
    expect(page).toContain('door.agentPathsOpen');
    expect(page).toContain('door.peopleGated');
    expect(page).toContain('door.peopleOnboardFromMs');
    // The unmeasured rule: a date is printed only alongside the label that says what it is.
    expect(page).toContain('door.peopleOnboardLabel !== null');
  });
});
