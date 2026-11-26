// @vitest-environment node
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
//
// The share card is the one surface a visitor sees before the site, and until 2026-11-25 it was
// also the one surface that ignored the site's mode: it said "closed alpha, by invitation" on a
// site whose front door was open. These tests make that impossible to reintroduce silently —
// the words come from the mode, and the mode's words are checked against the pages that say them.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';

const web = join(import.meta.dirname, '..');

let drawn: { element: unknown; size: unknown } | null = null;

vi.mock('next/og', () => ({
  ImageResponse: class {
    constructor(element: unknown, size: unknown) {
      drawn = { element, size };
    }
  },
}));

const readSiteMode = vi.fn<() => Promise<{ waitlistMode: boolean }>>();
vi.mock('@/lib/site-mode', () => ({ readSiteMode: () => readSiteMode() }));

import { shareCardCopy, SHARE_CARD_ALT } from '../lib/share-card';
import opengraph, { alt, revalidate, ShareCard } from '../app/opengraph-image';

/** Every line the card can set at headline size, in either mode. */
function openHeadlines(): string[] {
  return [shareCardCopy({ waitlistMode: false }), shareCardCopy({ waitlistMode: true })].flatMap((c) => [...c.headline]);
}

function textOf(node: unknown): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (typeof node === 'object' && 'props' in node) {
    return textOf((node as { props: { children?: unknown } }).props.children);
  }
  return '';
}

/// The words on the card the route last drew. The route hands the image engine an un-rendered
/// <ShareCard/> element — the engine renders it — so the test renders that one component itself.
function drawnText(): string {
  const passed = drawn?.element as { type: (props: unknown) => unknown; props: unknown } | undefined;
  if (passed === undefined) throw new Error('the route drew nothing');
  return textOf(passed.type(passed.props)).replace(/\u00a0/g, ' ');
}

const CLOSED_WORDS = /closed alpha|invitation|by invitation|doors open|leave your email/i;

const source = (file: string): string => readFileSync(join(web, file), 'utf8');

describe('the share card follows the site', () => {
  beforeAll(() => {
    drawn = null;
  });

  it('never says the site is closed while it is open', () => {
    const open = shareCardCopy({ waitlistMode: false });
    for (const words of [open.pill, ...open.headline, open.body, open.foot]) {
      expect(words).not.toMatch(CLOSED_WORDS);
    }
  });

  it('offers a way in when the site is open, and names the network it runs on', () => {
    const open = shareCardCopy({ waitlistMode: false });
    expect(open.foot).toMatch(/Create an account/i);
    expect(open.pill).toBe('LIVE ON SUI MAINNET');
  });

  it('says the site is closed, and how to get a code, while it is gated', () => {
    const gated = shareCardCopy({ waitlistMode: true });
    expect(`${gated.headline[0]} ${gated.headline[1]}`).toBe('Weir is in closed alpha.');
    expect(gated.foot).toMatch(/invitation\? Enter your code/i);
  });

  it('takes its open words from the landing page, so the two cannot disagree', () => {
    const landing = source('components/landing/LandingScreen.tsx');
    const open = shareCardCopy({ waitlistMode: false });
    for (const words of [...open.headline]) expect(landing).toContain(words);
    expect(open.pill.toLowerCase()).toBe('live on sui mainnet');
    expect(landing).toContain('Live on Sui mainnet');
    expect(landing).toContain('Create account');
  });

  it('takes its gated words from the waitlist page, for the same reason', () => {
    const waitlist = source('components/app/WaitlistScreen.tsx');
    const gated = shareCardCopy({ waitlistMode: true });
    expect(waitlist).toContain('Weir is in closed alpha.');
    expect(waitlist).toContain(
      'Creators are onboarding now, by invitation. Leave your email and we will send one message',
    );
  });
});

describe('the image route draws those words and no others', () => {
  it('describes itself truthfully in either mode, because the alt is exported statically', () => {
    expect(alt).toBe(SHARE_CARD_ALT);
    expect(alt).not.toMatch(CLOSED_WORDS);
  });

  it('draws the open card when the site is open', async () => {
    readSiteMode.mockResolvedValue({ waitlistMode: false });
    await opengraph();
    const text = drawnText();
    expect(text).toContain('LIVE ON SUI MAINNET');
    // Set on two lines: the longer of them must fit a 1200px card alone, which one line of both
    // did not (the first render cut "yours" off the right edge).
    expect(text).toContain('Weir someone.');
    expect(text).toContain('Your money stays yours.');
    for (const line of openHeadlines()) expect(line.length, line).toBeLessThanOrEqual(26);
    expect(text).not.toMatch(CLOSED_WORDS);
  });

  it('draws the closed card when the site is gated', async () => {
    readSiteMode.mockResolvedValue({ waitlistMode: true });
    await opengraph();
    const text = drawnText();
    expect(text).toContain('CLOSED ALPHA — BY INVITATION');
    expect(text).toContain('Weir is in');
    expect(text).toContain('closed alpha.');
  });

  it('reads the mode on every render rather than once at build time', () => {
    const route = source('app/opengraph-image.tsx');
    expect(route).toContain('readSiteMode()');
    expect(route).not.toMatch(/force-dynamic/);
  });

  it('is not an unauthenticated render on every hit', () => {
    expect(revalidate).toBeGreaterThanOrEqual(60);
  });

  it('lays the card out in three stacked bands, as the image engine requires', () => {
    const root = ShareCard({ copy: shareCardCopy({ waitlistMode: false }) }) as {
      props: { children: unknown[]; style: { display: string } };
    };
    expect(root.props.style.display).toBe('flex');
    expect(root.props.children).toHaveLength(3);
  });
});
