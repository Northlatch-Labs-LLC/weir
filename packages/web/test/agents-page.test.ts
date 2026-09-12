// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { formatBps, formatMinorUnits } from '../components/data/agents-data';
import { DESTINATIONS, FOOTER, titleFor } from '../lib/site-map';
import { AGENT_MANIFEST_DNS_ANCHOR, AGENT_MANIFEST_PATH } from '../lib/agent-manifest';

const root = join(import.meta.dirname, '..');
const read = (p: string): string => readFileSync(join(root, p), 'utf8');

const codeOf = (p: string): string =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

describe('formatMinorUnits — minor units to a readable figure', () => {
  it('moves the point rather than dividing', () => {
    expect(formatMinorUnits('29000000000', 9)).toBe('29');
  });

  it('keeps a fractional part and trims only trailing zeros', () => {
    expect(formatMinorUnits('2152388', 9)).toBe('0.002152388');
    expect(formatMinorUnits('1500000', 6)).toBe('1.5');
    expect(formatMinorUnits('1000000', 6)).toBe('1');
  });

  it('is exact above 2^53, where a float implementation is not', () => {
    expect(formatMinorUnits('9007199254740993', 9)).toBe('9007199.254740993');
    expect(formatMinorUnits('18446744073709551615', 9)).toBe('18446744073.709551615');
  });

  it('handles a value smaller than one whole unit', () => {
    expect(formatMinorUnits('1', 9)).toBe('0.000000001');
    expect(formatMinorUnits('0', 9)).toBe('0');
  });

  it('refuses rather than guesses on anything that is not a run of digits', () => {
    for (const bad of ['', '-1', '1.5', '1e9', 'abc', '29 SUI', ' 29']) {
      expect(formatMinorUnits(bad, 9), bad).toBeNull();
    }
  });

  it('refuses an implausible or non-integer scale', () => {
    expect(formatMinorUnits('1000', -1)).toBeNull();
    expect(formatMinorUnits('1000', 1.5)).toBeNull();
    expect(formatMinorUnits('1000', 39)).toBeNull();
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
    expect(formatBps('290', '1000000')).toBe('0.02%');
    expect(formatBps('290', '100')).toBe('290%');
  });

  it('handles the ceiling and the floor', () => {
    expect(formatBps('0', '10000')).toBe('0%');
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
    expect(() => read('app/agents/page.tsx')).not.toThrow();
  });

  it('/agents is a registered destination, so titleFor resolves it', () => {
    expect(DESTINATIONS.has('/agents')).toBe(true);
    expect(titleFor('/agents')).not.toBeNull();
  });

  it('the proxy lets it through while the door is shut', () => {
    const door = read('lib/front-door.ts');
    const allowlist = door.slice(door.indexOf('export const ALWAYS_OPEN'), door.indexOf('export function isAlwaysOpen'));
    expect(allowlist).toContain("'/agents'");
    expect(read('proxy.ts')).toContain("from '@/lib/front-door'");
  });

  it('appears in the footer both when the door is open and when it is shut', () => {
    const hrefs = (list: readonly { href: string }[]) => list.map((d) => d.href);
    expect(hrefs(FOOTER.product)).toContain('/agents');
    expect(hrefs(FOOTER.gated)).toContain('/agents');
  });
});

describe('the page cannot drift from the manifest', () => {
  it('takes its path and DNS anchor from the manifest constants, not from a literal', () => {
    const data = read('components/data/agents-data.tsx');
    expect(data).toContain('AGENT_MANIFEST_PATH');
    expect(data).toContain('AGENT_MANIFEST_DNS_ANCHOR');
    expect(data).not.toContain("'/.well-known/weir-agent.json'");
    expect(data).not.toContain("'_weir-agent.weir.social'");
  });

  it('reads one manifest rather than re-reading the chain', () => {
    const data = codeOf('components/data/agents-data.tsx');
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
    const data = codeOf('components/data/agents-data.tsx');
    for (const forbidden of ['?? 0', '|| 0', "?? '—'", "|| '—'", "?? 'unknown'"]) {
      expect(data.includes(forbidden), `found ${forbidden}`).toBe(false);
    }
  });

  it('the component renders a value it has not read as words, not as a blank', () => {
    const view = read('components/design/Agents.tsx');
    expect(view).toContain('reading from the chain');
    expect(view).toContain('fact.unavailable');
  });
});
