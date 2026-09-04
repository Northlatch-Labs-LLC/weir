// Built-by: @projectx.sui /|\ · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
/**
 * `/agents` — the page, its wiring, and the two conversions it does to money.
 *
 * # What is worth testing here and what is not
 *
 * The prose is not tested; it is prose. What is tested is everything that could be silently wrong:
 * the arithmetic that turns chain quantities into figures an operator reads, the wiring that makes
 * the page reachable, and the registration that makes its title resolve. Each of those fails
 * quietly — a mis-scaled fee looks like a fee, an unreachable page looks like a redirect, and a
 * missing site-map entry throws at module load in production rather than here.
 *
 * # The precision cases are the point
 *
 * `formatMinorUnits` exists because `Number(mist) / 1e9` is wrong above 2^53, and a creation fee
 * or a balance is exactly where a large number appears. The tests below include values past that
 * boundary specifically, because a float implementation passes every small case and fails only on
 * the ones that matter.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { formatBps, formatMinorUnits } from '../components/design/agents-data';
import { DESTINATIONS, FOOTER, titleFor } from '../lib/site-map';
import { AGENT_MANIFEST_DNS_ANCHOR, AGENT_MANIFEST_PATH } from '../lib/agent-manifest';

const root = join(import.meta.dirname, '..');
const read = (p: string): string => readFileSync(join(root, p), 'utf8');

/**
 * A file with its comments removed.
 *
 * Both of the checks below scan source text for patterns that must not appear. Scanning the raw
 * file makes them fail on their own documentation: the data layer's header explains why `?? 0` is
 * forbidden, and saying so is not doing it. Strip block and line comments first, so the assertion
 * is about code and a comment explaining the rule cannot break the rule.
 */
const codeOf = (p: string): string =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

describe('formatMinorUnits — minor units to a readable figure', () => {
  it('moves the point rather than dividing', () => {
    // 29 SUI, the creation fee at the time of writing. Nine decimals.
    expect(formatMinorUnits('29000000000', 9)).toBe('29');
  });

  it('keeps a fractional part and trims only trailing zeros', () => {
    expect(formatMinorUnits('2152388', 9)).toBe('0.002152388');
    expect(formatMinorUnits('1500000', 6)).toBe('1.5');
    expect(formatMinorUnits('1000000', 6)).toBe('1');
  });

  it('is exact above 2^53, where a float implementation is not', () => {
    /*
      9007199254740993 is 2^53 + 1 — the first integer a double cannot represent. A division-based
      implementation returns 9007199.254740992 here, losing the final unit. That final unit is the
      difference between an exact-amount call succeeding and aborting.
    */
    expect(formatMinorUnits('9007199254740993', 9)).toBe('9007199.254740993');
    expect(formatMinorUnits('18446744073709551615', 9)).toBe('18446744073.709551615');
  });

  it('handles a value smaller than one whole unit', () => {
    expect(formatMinorUnits('1', 9)).toBe('0.000000001');
    expect(formatMinorUnits('0', 9)).toBe('0');
  });

  it('refuses rather than guesses on anything that is not a run of digits', () => {
    // A fee we cannot parse is a fee we have not measured. Null forces the caller to say so.
    for (const bad of ['', '-1', '1.5', '1e9', 'abc', '29 SUI', ' 29']) {
      expect(formatMinorUnits(bad, 9), bad).toBeNull();
    }
  });

  it('refuses an implausible or non-integer scale', () => {
    expect(formatMinorUnits('1000', -1)).toBeNull();
    expect(formatMinorUnits('1000', 1.5)).toBeNull();
    expect(formatMinorUnits('1000', 39)).toBeNull();
    // The last accepted value and the first rejected one, both asserted.
    expect(formatMinorUnits('1000', 38)).not.toBeNull();
    expect(formatMinorUnits('1000', 0)).toBe('1000');
  });
});

describe('formatBps — basis points against the published denominator', () => {
  it('renders the live platform fee', () => {
    expect(formatBps('290', '10000')).toBe('2.9%');
  });

  it('renders the referral share', () => {
    expect(formatBps('500', '10000')).toBe('5%');
  });

  it('scales against the denominator rather than assuming 10000', () => {
    /*
      The denominator is read from the manifest for this reason: if the contract ever expressed
      fees per million, dividing by 100 would show 2.9% where the truth was 0.029%. The figure
      would look ordinary and be wrong by two orders of magnitude.
    */
    expect(formatBps('290', '1000000')).toBe('0.02%');
    expect(formatBps('290', '100')).toBe('290%');
  });

  it('handles the ceiling and the floor', () => {
    expect(formatBps('0', '10000')).toBe('0%');
    // MAX_PLATFORM_FEE_BPS is 3000 in platform.move.
    expect(formatBps('3000', '10000')).toBe('30%');
  });

  it('refuses a zero denominator instead of dividing by it', () => {
    expect(formatBps('290', '0')).toBeNull();
  });

  it('refuses malformed input', () => {
    for (const [bps, d] of [['', '10000'], ['2.9', '10000'], ['290', '1e4'], ['-290', '10000']]) {
      expect(formatBps(bps!, d!), `${bps}/${d}`).toBeNull();
    }
  });
});

describe('the page is wired so it can actually be reached', () => {
  it('the route file exists where the site map says the page is', () => {
    // A destination with no handler is a 404 with a working breadcrumb, which is worse than either.
    expect(() => read('app/agents/page.tsx')).not.toThrow();
  });

  it('/agents is a registered destination, so titleFor resolves it', () => {
    expect(DESTINATIONS.has('/agents')).toBe(true);
    expect(titleFor('/agents')).not.toBeNull();
  });

  it('the proxy lets it through while the door is shut', () => {
    /*
      The whole point of this page is to be readable by somebody who has no account and is not
      asking for one. If the closed-alpha proxy redirects it to the waiting list, the page exists
      and nobody outside can see it — and the manifest, which IS open, points at it.
    */
    /*
      The list moved to `lib/front-door.ts` on 2026-09-04; the proxy imports it. Both halves are
      asserted, because "the array names /agents" and "the gate reads that array" became two
      claims when the file split.
    */
    const door = read('lib/front-door.ts');
    const allowlist = door.slice(door.indexOf('export const ALWAYS_OPEN'), door.indexOf('export function isAlwaysOpen'));
    expect(allowlist).toContain("'/agents'");
    expect(read('proxy.ts')).toContain("from '@/lib/front-door'");
  });

  it('appears in the footer both when the door is open and when it is shut', () => {
    const hrefs = (list: readonly { href: string }[]) => list.map((d) => d.href);
    expect(hrefs(FOOTER.product)).toContain('/agents');
    // `gated` is what the footer shows in waiting-list mode. An operator arriving then still needs it.
    expect(hrefs(FOOTER.gated)).toContain('/agents');
  });
});

describe('the page cannot drift from the manifest', () => {
  it('takes its path and DNS anchor from the manifest constants, not from a literal', () => {
    /*
      If this page printed '/.well-known/weir-agent.json' as a string of its own, renaming the
      manifest path would leave a page confidently pointing at a 404. Reading the constant means
      the rename breaks the build instead.
    */
    const data = read('components/design/agents-data.tsx');
    expect(data).toContain('AGENT_MANIFEST_PATH');
    expect(data).toContain('AGENT_MANIFEST_DNS_ANCHOR');
    expect(data).not.toContain("'/.well-known/weir-agent.json'");
    expect(data).not.toContain("'_weir-agent.weir.social'");
  });

  it('reads one manifest rather than re-reading the chain', () => {
    // Two reads would be two moments, and the page could disagree with the document an agent
    // fetches one second later. There is exactly one call.
    const data = codeOf('components/design/agents-data.tsx');
    // `await agentManifest(` is the call; the bare name also appears in the import line.
    expect(data.match(/await agentManifest\(/g)?.length).toBe(1);
    expect(data).not.toContain('readPlatform');
    expect(data).not.toContain('createClient');
  });

  it('the constants it imports are the ones the manifest actually publishes', () => {
    expect(AGENT_MANIFEST_PATH).toBe('/.well-known/weir-agent.json');
    expect(AGENT_MANIFEST_DNS_ANCHOR.startsWith('_weir-agent.')).toBe(true);
  });
});

describe('a failed read never becomes a value', () => {
  it('the data layer contains no fallback that would turn a failure into a figure', () => {
    /*
      This is the rule the whole page is built on, asserted against the source because it is the
      kind of thing a well-meaning edit reintroduces. `?? 0`, `|| 0`, `?? '—'` on a measured
      quantity are each a way to make an outage look like an observation.
    */
    const data = codeOf('components/design/agents-data.tsx');
    for (const forbidden of ['?? 0', '|| 0', "?? '—'", "|| '—'", "?? 'unknown'"]) {
      expect(data.includes(forbidden), `found ${forbidden}`).toBe(false);
    }
  });

  it('the component renders an unmeasured value as words, not as a blank', () => {
    const view = read('components/design/Agents.tsx');
    expect(view).toContain('not measured');
    // And the reason travels with it, so the reader knows whether it is unconfigured or broken.
    expect(view).toContain('fact.unavailable');
  });
});
