// @vitest-environment happy-dom
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MIN_HANDLE_LEN, MAX_HANDLE_LEN } from '@projectx-social/sdk';
import type { WaitlistOutcome, WaitlistStanding } from '../lib/waitlist';

const web = process.cwd();

const submitted = vi.hoisted(() => ({ outcome: null as WaitlistOutcome | null }));

vi.mock('../lib/waitlist', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/waitlist')>();
  return {
    ...actual,
    submitWaitlist: vi.fn(async () => submitted.outcome ?? { ok: false, kind: 'transport', detail: 'unset' }),
  };
});

const { WaitlistPanel } = await import('../components/app/WaitlistPanel');

const standing = (over: Partial<WaitlistStanding> = {}): WaitlistStanding => ({
  position: 47,
  total: 1203,
  refCode: 'ABCD1234',
  referred: 0,
  ...over,
});

async function joinList(props: { gated?: boolean } = {}, value?: WaitlistStanding) {
  submitted.outcome = { ok: true, already: false, ...(value === undefined ? {} : { standing: value }) };
  render(<WaitlistPanel {...props} />);
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'reader@example.com' } });
  fireEvent.click(screen.getByRole('button', { name: props.gated ? 'Join the waiting list' : 'Join the list' }));
  await screen.findByText(/on the list\.|You are on the list\./);
}

function panelText(): string {
  return (document.body.textContent ?? '').replace(/\s+/g, ' ');
}

beforeEach(() => {
  submitted.outcome = null;
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({}), { status: 200 })));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('the link out of the waiting list is a door the proxy opens', () => {
  const door = readFileSync(join(web, 'lib/front-door.ts'), 'utf8');

  function alwaysOpen(): string[] {
    const line = /const ALWAYS_OPEN = \[([\s\S]*?)\];/.exec(door);
    expect(line, 'ALWAYS_OPEN not found in lib/front-door.ts').not.toBeNull();
    const bare = (line?.[1] ?? '').replace(/\/\*[\s\S]*?\*\//g, '');
    return [...bare.matchAll(/'([^']+)'/g)].map((m) => m[1] as string);
  }

  it('admits every path the waiting list links to', () => {
    render(<WaitlistPanel />);
    const open = alwaysOpen();

    const targets = [...document.querySelectorAll('a[href^="/"]')]
      .map((a) => a.getAttribute('href') ?? '')
      // `/` is the feed, and it is deliberately behind the gate when the door is closed.
      .filter((href) => href !== '/');

    expect(targets.length).toBeGreaterThan(0);
    for (const href of targets) {
      expect(open.some((prefix) => href === prefix || href.startsWith(prefix)), `${href} is not in ALWAYS_OPEN`).toBe(true);
    }
  });

  it('names /security specifically, because that is the link the page carries', () => {
    expect(alwaysOpen()).toContain('/security');
    expect(screen.queryByRole('link', { name: 'Read the contracts' })).toBeNull();
    render(<WaitlistPanel />);
    expect(screen.getByRole('link', { name: 'Read the contracts' }).getAttribute('href')).toBe('/security');
  });
});

describe('the confirmation is a sentence at every value', () => {
  it.each([
    [1, 'You are number 1 on the list.'],
    [47, 'You are number 47 on the list.'],
    [100, 'You are number 100 on the list.'],
    [1_000_000, 'You are number 1,000,000 on the list.'],
  ])('reads correctly at position %i', async (position, sentence) => {
    await joinList({}, standing({ position }));
    expect(panelText()).toContain(sentence);
  });

  it('falls back to the numberless sentence when there is no usable position', async () => {
    await joinList({}, standing({ position: Number.NaN }));
    expect(panelText()).toContain('You are on the list.');
    expect(panelText()).not.toContain('NaN');
  });

  it('never strands an ordinal suffix', async () => {
    for (const position of [1, 2, 3, 11, 21, 47, 100, 1203]) {
      await joinList({}, standing({ position }));
      const text = panelText();
      for (const suffix of ['st', 'nd', 'rd', 'th']) {
        expect(text, `stranded "${suffix}" at ${position}`).not.toContain(`${position.toLocaleString()} ${suffix} `);
      }
      expect(text).not.toContain('address to join');
      cleanup();
    }
  });
});

describe('the openness claim follows the gate', () => {
  it('says the site is open when it is', async () => {
    await joinList({ gated: false }, standing());
    expect(panelText()).toContain('Arrival order, not a queue. Nothing is served in turn; Weir is already live and open to read.');
  });

  it('does not tell a turned-away reader the door is open', async () => {
    await joinList({ gated: true }, standing());
    const text = panelText();
    expect(text).toContain('Arrival order, not a queue. Nothing is served in turn; the doors have not opened yet.');
    expect(text).not.toContain('already live and open to read');
  });
});

describe('the handle field never fails silently', () => {
  async function noteFor(handle: string, body: unknown = {}): Promise<string> {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })));
    render(<WaitlistPanel />);
    fireEvent.change(screen.getByLabelText(/Handle you want/), { target: { value: handle } });
    const field = screen.getByLabelText(/Handle you want/);
    const note = field.closest('div')?.parentElement?.querySelector('p');
    expect(note).not.toBeNull();
    return (note?.textContent ?? '').trim();
  }

  it('tells a too-short handle it is too short', async () => {
    expect(await noteFor('ab')).toBe('A handle is at least 3 characters.');
  });

  it('tells a too-long handle it is too long', async () => {
    expect(await noteFor('a'.repeat(MAX_HANDLE_LEN + 10))).toBe(
      `A handle is at most ${MAX_HANDLE_LEN} characters.`,
    );
  });

  it('rejects a dash', async () => {
    expect(await noteFor('ab-cd')).toBe('Handles use lowercase letters, numbers and underscores only.');
  });

  it('rejects a space', async () => {
    expect(await noteFor('ab cd')).toBe('Handles use lowercase letters, numbers and underscores only.');
  });

  it('warns about an uppercase letter rather than absorbing it', async () => {
    expect(await noteFor('Alice')).toBe('Lowercase only. The contract rejects capitals rather than converting them.');
  });

  it('surfaces a registry rejection instead of showing "Optional."', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ handle: { state: 'invalid' } }), { status: 200 })),
    );
    render(<WaitlistPanel />);
    fireEvent.change(screen.getByLabelText(/Handle you want/), { target: { value: 'well_formed_handle' } });
    await vi.advanceTimersByTimeAsync(600);
    vi.useRealTimers();

    await waitFor(() => {
      expect(panelText()).toContain(
        `Not a valid handle. Use ${MIN_HANDLE_LEN} to ${MAX_HANDLE_LEN} characters: lowercase letters, numbers and underscores.`,
      );
    });
    expect(panelText()).not.toContain('Optional.');
  });

  it('states the contract bounds, not literals', () => {
    expect(MIN_HANDLE_LEN).toBe(3);
    expect(MAX_HANDLE_LEN).toBe(30);
    const source = readFileSync(join(web, 'components', 'app', 'WaitlistPanel.tsx'), 'utf8');
    expect(source).toContain('MIN_HANDLE_LEN');
    expect(source).toContain('MAX_HANDLE_LEN');
  });

  it('still says the field is optional when it is empty', async () => {
    expect(await noteFor('')).toBe('Optional. We will note it. It is yours once you mint it on chain.');
  });
});
