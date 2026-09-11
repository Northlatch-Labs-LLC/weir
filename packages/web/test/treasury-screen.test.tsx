// @vitest-environment happy-dom
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

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
    const said = document.body.textContent?.match(/The epoch could not be read/g) ?? [];
    expect(said).toHaveLength(1);
  });
});

describe('the simulator', () => {
  it('states what comes back and quotes no yield', () => {
    view();
    expect(screen.getByText('all of it, any time')).toBeTruthy();
    expect(screen.getByText('the staking yield it earns')).toBeTruthy();
    expect(screen.queryByText(/APY/i)).toBeNull();
    expect(screen.queryByText(/you would earn/i)).toBeNull();
  });

  it('carries the capture figure it was given rather than one of its own', () => {
    view({ capturePct: '85.7%' });
    expect(screen.getByText('85.7% of theoretical maximum')).toBeTruthy();
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
