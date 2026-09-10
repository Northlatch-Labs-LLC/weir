// @vitest-environment happy-dom
// Built-by: @projectx.sui · Co-authored-by: Claude
/**
 * What `/treasury` is allowed to say.
 *
 * This is the page somebody reads before putting money behind a stranger, so the three rules it
 * has to keep are the three this file holds down:
 *
 *   1. A figure nobody could read is never a value, and never printed twelve times either — the
 *      reason is stated once, above the list.
 *   2. "No pool open" is the store answering and is shown. It is not the same sentence as "we
 *      could not look", and the two never share a typography.
 *   3. A rung whose position is unknown is never drawn as open. That is the one error that costs
 *      somebody a withdrawal they were counting on.
 *
 * The simulator quotes no yield, deliberately, and that is asserted here too: returns vary by
 * validator and epoch, and a number invented on this page would be the thing the rest of it argues
 * against.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

vi.mock('@/components/app/AppFrame', () => ({
  AppFrame: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

const { TreasuryScreen } = await import('../components/app/TreasuryScreen');

afterEach(cleanup);

const LADDER_OPEN = [
  { name: 'rung 1', pct: '50%', state: 'open' as const, label: 'unlocked' },
  { name: 'rung 2', pct: '100%', state: 'maturing' as const, label: 'maturing' },
];
const LADDER_UNPLACED = [
  { name: 'rung 1', pct: '50%', state: 'unplaced' as const, label: '' },
  { name: 'rung 2', pct: '100%', state: 'unplaced' as const, label: '' },
];

function pool(over: Record<string, unknown> = {}) {
  return {
    handle: 'wren',
    address: `0x${'d'.repeat(64)}`,
    displayName: 'Wren',
    pooled: '1,200 SUI',
    pooledState: 'measured' as const,
    yieldShare: '4%',
    yieldState: 'measured' as const,
    validator: '0x1234…abcd',
    funded: [true, false],
    ...over,
  };
}

function view(props: Partial<Parameters<typeof TreasuryScreen>[0]> = {}) {
  return render(
    <TreasuryScreen
      viewerAddress={null}
      viewerHandle={null}
      pools={[pool()]}
      poolNote=""
      ladder={LADDER_OPEN}
      epochLabel="epoch 812 · 1 of 2 rungs unlocked now"
      epochUnread={false}
      capturePct="85.7%"
      rungCount={2}
      {...props}
    />,
  );
}

describe('a figure that was read', () => {
  it('prints as a figure', () => {
    view();
    expect(screen.getByText('1,200 SUI')).toBeTruthy();
    expect(screen.getByText('4%')).toBeTruthy();
    expect(screen.getByText('Validator 0x1234…abcd')).toBeTruthy();
  });
});

describe('a creator with no pool', () => {
  it('says so, and never as a zero', () => {
    view({
      pools: [pool({ pooled: 'no pool open', pooledState: 'none', yieldShare: 'no pool', yieldState: 'none', funded: [false, false] })],
    });
    expect(screen.getByText('no pool open')).toBeTruthy();
    /*
      Not a bare `0` — the simulator states "functions that can move your principal: 0", which is a
      count of functions in the contract and is exactly right. What must never appear is a POOLED
      figure of zero for somebody who has no pool.
    */
    expect(screen.queryByText('0 SUI')).toBeNull();
    expect(screen.queryByText('0%')).toBeNull();
  });

  it('draws no rung chart, because there is no vault to chart', () => {
    const { container } = view({
      pools: [pool({ pooledState: 'none', funded: [false, false] })],
    });
    expect(container.querySelector('.w-bars')).toBeNull();
  });
});

describe('an index that could not be read', () => {
  /*
    The repetition rule. Two figures times six creators printed the same dash twelve times, on the
    page whose job is to show a stranger that money moves here.
  */
  it('states the reason once and prints no figure at all', () => {
    const { container } = view({
      poolNote: 'The pool index could not be read just now.',
      pools: [
        pool({ pooled: '—', pooledState: 'unread', yieldShare: '—', yieldState: 'unread' }),
        pool({ handle: 'kaela_ai', displayName: 'Kaela', pooled: '—', pooledState: 'unread', yieldShare: '—', yieldState: 'unread' }),
      ],
    });
    expect(screen.getByText('The pool index could not be read just now.')).toBeTruthy();
    expect(screen.queryAllByText('—')).toHaveLength(0);
    expect(container.querySelectorAll('.w-figs')).toHaveLength(0);
    // The people are still listed. An unreadable index is not an empty platform.
    expect(screen.getByText('Wren')).toBeTruthy();
    expect(screen.getByText('Kaela')).toBeTruthy();
  });
});

describe('the ladder', () => {
  it('marks an open rung open', () => {
    const { container } = view();
    expect(container.querySelectorAll('.w-ladder__fill--open')).toHaveLength(1);
    expect(screen.getByText('unlocked')).toBeTruthy();
  });

  it('never draws a rung as open when the epoch could not be read', () => {
    const { container } = view({
      ladder: LADDER_UNPLACED,
      epochLabel: 'The epoch could not be read, so no rung is shown as unlocked.',
      epochUnread: true,
    });
    expect(container.querySelectorAll('.w-ladder__fill--open')).toHaveLength(0);
    expect(screen.queryByText('unlocked')).toBeNull();
    expect(screen.getByText('The epoch could not be read, so no rung is shown as unlocked.')).toBeTruthy();
  });

  it('says the position once, not once per rung', () => {
    view({ ladder: LADDER_UNPLACED, epochLabel: 'The epoch could not be read.', epochUnread: true });
    /*
      Counted in the rendered text rather than in elements: two rungs must not each carry the
      sentence, and a query that matches a paragraph and the span inside it would count one
      sentence twice and prove nothing.
    */
    const said = document.body.textContent?.match(/The epoch could not be read/g) ?? [];
    expect(said).toHaveLength(1);
  });
});

describe('the simulator', () => {
  it('states what comes back and quotes no yield', () => {
    view();
    expect(screen.getByText('all of it, any time')).toBeTruthy();
    expect(screen.getByText('the staking yield it earns')).toBeTruthy();
    // No APY, no percentage return, no projection. The capture figure is the contract's own.
    expect(screen.queryByText(/APY/i)).toBeNull();
    expect(screen.queryByText(/you would earn/i)).toBeNull();
  });

  it('carries the capture figure it was given rather than one of its own', () => {
    view({ capturePct: '85.7%' });
    expect(screen.getByText('85.7% of theoretical maximum')).toBeTruthy();
    // The remainder is derived from it, so the two can never disagree.
    expect(screen.getByText(/costs 14.3% of the/)).toBeTruthy();
  });
});

describe('no pools at all', () => {
  it('is a measured absence, not a failure', () => {
    const { container } = view({ pools: [] });
    expect(screen.getByText('No pools are open yet.')).toBeTruthy();
    expect(container.querySelector('.w-state--error')).toBeNull();
  });
});
