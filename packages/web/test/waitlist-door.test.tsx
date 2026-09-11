// @vitest-environment happy-dom
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
/**
 * The waiting list is the only page a stranger can reach, so every sentence on it is load-bearing.
 *
 * # What these guard
 *
 * Four defects, each of which was live, fully typed and green:
 *
 *   - The one outbound link pointed at `/security`, which the proxy did not admit, so it answered
 *     307 back to the waiting list the reader was standing on.
 *   - The confirmation read "You are number 47 th address to join" — a bare ordinal suffix that
 *     agreed with no value it was ever printed beside.
 *   - "Weir is already live and open to read" rendered unconditionally, including to a reader the
 *     gate had turned away one redirect earlier.
 *   - The handle field had no branch for `malformed`, so a handle the registry had just called
 *     invalid produced the same dim `Optional.` as an untouched field.
 *
 * None of them is the kind of thing a type checker can see. Each is a string that is wrong, or a
 * branch that is missing, and only reading the rendered output catches either.
 *
 * # Why the exact strings

 * These assert full sentences rather than fragments. A fragment match would survive the ordinal
 * suffix coming back — "You are number" is present in both the broken copy and the fixed copy —
 * and the suffix is the entire defect.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MIN_HANDLE_LEN, MAX_HANDLE_LEN } from '@projectx-social/sdk';
import type { WaitlistOutcome, WaitlistStanding } from '../lib/waitlist';

/*
  Sources are located from the runner's working directory, not from `import.meta`.

  Under the happy-dom environment `import.meta.dirname` and `node:url`'s `fileURLToPath` do not
  return a usable path the way they do in the Node-environment suites. Vitest runs with its root at
  `packages/web`, which is the directory these two files sit under.
*/
const web = process.cwd();

/*
  `submitWaitlist` is replaced; `handleShapeProblem` is not.

  The standing panel renders only after a successful send, and the send is the one thing in this
  component that must not reach the network. Everything else in the module is the real
  implementation, because the shape rules are half of what is under test here and a stubbed
  validator would assert nothing.
*/
const submitted = vi.hoisted(() => ({ outcome: null as WaitlistOutcome | null }));

vi.mock('../lib/waitlist', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/waitlist')>();
  return {
    ...actual,
    submitWaitlist: vi.fn(async () => submitted.outcome ?? { ok: false, kind: 'transport', detail: 'unset' }),
  };
});

const { DesignWaitlist } = await import('../components/design/Waitlist');

const standing = (over: Partial<WaitlistStanding> = {}): WaitlistStanding => ({
  position: 47,
  total: 1203,
  refCode: 'ABCD1234',
  referred: 0,
  ...over,
});

/** Join with a standing the server is pretending to have returned, and settle the result. */
async function joinList(props: { gated?: boolean } = {}, value?: WaitlistStanding) {
  submitted.outcome = { ok: true, already: false, ...(value === undefined ? {} : { standing: value }) };
  render(<DesignWaitlist {...props} />);
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'reader@example.com' } });
  fireEvent.click(screen.getByRole('button', { name: props.gated ? 'Join the waiting list' : 'Join the list' }));
  await screen.findByText(/on the list\.|You are on the list\./);
}

/** The whole panel's text, whitespace collapsed, so assertions read like the sentence does. */
function panelText(): string {
  return (document.body.textContent ?? '').replace(/\s+/g, ' ');
}

beforeEach(() => {
  submitted.outcome = null;
  /*
    The availability hook reads `/api/account`. Left unstubbed it would attempt a real request from
    happy-dom, and the state under test would be `unreadable` rather than the one the case is about.
  */
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({}), { status: 200 })));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// D1 — the only outbound link on the only reachable page
// ---------------------------------------------------------------------------

describe('the link out of the waiting list is a door the proxy opens', () => {
  /*
    `ALWAYS_OPEN` moved from `proxy.ts` to `lib/front-door.ts` on 2026-09-04 — the agent manifest
    reads it too now. Still read as source rather than imported, for the reason it always was:
    importing the array would assert that a value equals itself.
  */
  const door = readFileSync(join(web, 'lib/front-door.ts'), 'utf8');

  /** The `ALWAYS_OPEN` array as written, read from the source rather than imported. */
  function alwaysOpen(): string[] {
    const line = /const ALWAYS_OPEN = \[([\s\S]*?)\];/.exec(door);
    expect(line, 'ALWAYS_OPEN not found in lib/front-door.ts').not.toBeNull();
    // Comments are stripped first: several entries carry a block comment above them containing
    // quoted paths, and those are prose about the list rather than members of it.
    const bare = (line?.[1] ?? '').replace(/\/\*[\s\S]*?\*\//g, '');
    return [...bare.matchAll(/'([^']+)'/g)].map((m) => m[1] as string);
  }

  it('admits every path the waiting list links to', () => {
    render(<DesignWaitlist />);
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
    render(<DesignWaitlist />);
    expect(screen.getByRole('link', { name: 'Read the contracts' }).getAttribute('href')).toBe('/security');
  });
});

// ---------------------------------------------------------------------------
// D2 — the sentence every successful signup reads
// ---------------------------------------------------------------------------

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
      // The noun that used to follow the suffix went with it.
      expect(text).not.toContain('address to join');
      cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// D3 — the page must not contradict the gate
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// D4 — the handle field says what is wrong
// ---------------------------------------------------------------------------

describe('the handle field never fails silently', () => {
  /** Type a handle and return the note rendered under the field. */
  async function noteFor(handle: string, body: unknown = {}): Promise<string> {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })));
    render(<DesignWaitlist />);
    fireEvent.change(screen.getByLabelText(/Handle you want/), { target: { value: handle } });
    const field = screen.getByLabelText(/Handle you want/);
    const note = field.closest('div')?.parentElement?.querySelector('p');
    expect(note).not.toBeNull();
    return (note?.textContent ?? '').trim();
  }

  it('tells a too-short handle it is too short', async () => {
    expect(await noteFor('ab')).toBe('A handle is at least 3 characters.');
  });

  /*
    The bound is read from the SDK, not written here.

    This assertion held the literal `at most 32 characters` and went red the moment the real
    contract ceiling of 30 reached the validator — which is the correct outcome: a literal in a
    test is a second source of truth. Written this way it cannot go stale again, because it moves
    with `account.move` through the SDK's drift test.
  */
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

  /*
    Uppercase is the case the field used to accept and quietly change. `handleShapeProblem`
    lower-cases before it validates, so "Alice" satisfies every local rule, and the availability
    look also lower-cases — so the registry answers for "alice" and the field turns green for a
    handle `account.move` would refuse as typed.
  */
  it('warns about an uppercase letter rather than absorbing it', async () => {
    expect(await noteFor('Alice')).toBe('Lowercase only. The contract rejects capitals rather than converting them.');
  });

  /*
    The state that had no branch at all.

    This test used to reach it with a 31-character handle, on the reasoning that the local rules
    and the contract's disagreed — `handleShapeProblem` permitted 32 while `account.move`
    permitted 30 — so a 31-character handle passed locally, reached the registry and came back
    invalid. That gap is closed, and the route with it: 31 characters is now refused before a
    request is ever made.

    Closing one route into a state does not make the state unreachable, and it must not make it
    untested. The registry is the authority on a handle and this client is not: it can refuse one
    that satisfies every local rule — a name reserved on chain, a race against another mint, or a
    rule `account.move` gains that this file has not learned yet. The handle below is deliberately
    well-formed by every local rule, so the ONLY thing that can reject it is the registry, which is
    exactly the condition this branch exists to render.

    Written this way the test survives the next tightening of the local rules, where the old
    version would have gone green while testing nothing at all.
  */
  it('surfaces a registry rejection instead of showing "Optional."', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ handle: { state: 'invalid' } }), { status: 200 })),
    );
    render(<DesignWaitlist />);
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

  /*
    The bounds in that message are the contract's, not this file's.

    Asserted against the SDK constants, which a drift test in turn asserts against `account.move`.
    A literal here would pass forever after the contract changed.
  */
  it('states the contract bounds, not literals', () => {
    expect(MIN_HANDLE_LEN).toBe(3);
    expect(MAX_HANDLE_LEN).toBe(30);
    const source = readFileSync(join(web, 'components', 'design', 'Waitlist.tsx'), 'utf8');
    expect(source).toContain('MIN_HANDLE_LEN');
    expect(source).toContain('MAX_HANDLE_LEN');
  });

  it('still says the field is optional when it is empty', async () => {
    expect(await noteFor('')).toBe('Optional. We will note it. It is yours once you mint it on chain.');
  });
});
