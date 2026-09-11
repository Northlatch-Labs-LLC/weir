// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
/**
 * A vault's face is drawn from its id, and its fill is drawn from a reading.
 *
 * The one thing this must never do is draw a full basin over a balance nobody read. A sigil is a
 * claim about somebody's money the moment it shows a level, so the absent case is the case worth
 * pinning hardest.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { VaultSigil } from '../src/brand/VaultSigil';

afterEach(cleanup);

const A = `0x${'a'.repeat(64)}`;
const B = `0x${'b'.repeat(64)}`;

/** The rectangle clipped to the basin. Absent means the basin drew empty. */
function level(container: HTMLElement): SVGRectElement | null {
  return container.querySelector('rect');
}

describe('the same vault always draws the same sigil', () => {
  it('is identical across renders', () => {
    const first = render(<VaultSigil vaultId={A} />).container.innerHTML;
    cleanup();
    const second = render(<VaultSigil vaultId={A} />).container.innerHTML;
    expect(second).toBe(first);
  });

  it('differs between two vaults', () => {
    const first = render(<VaultSigil vaultId={A} />).container.innerHTML;
    cleanup();
    const second = render(<VaultSigil vaultId={B} />).container.innerHTML;
    expect(second).not.toBe(first);
  });
});

describe('the fill is a reading, never a default', () => {
  it('draws no level at all when the balance was not read', () => {
    // `fill` defaults to null. A basin that looked full over an unread balance would be telling
    // somebody their money is there on the strength of a failed request.
    const { container } = render(<VaultSigil vaultId={A} />);
    expect(level(container)).toBeNull();
  });

  it('draws no level for an empty vault either, rather than a sliver', () => {
    const { container } = render(<VaultSigil vaultId={A} fill={0} />);
    expect(level(container)).toBeNull();
  });

  it('draws a level when there is one', () => {
    const { container } = render(<VaultSigil vaultId={A} fill={0.5} />);
    expect(level(container)).not.toBeNull();
  });

  it('a fuller vault draws a taller level', () => {
    const half = render(<VaultSigil vaultId={A} fill={0.5} />);
    const halfHeight = Number(level(half.container)?.getAttribute('height'));
    cleanup();
    const full = render(<VaultSigil vaultId={A} fill={1} />);
    const fullHeight = Number(level(full.container)?.getAttribute('height'));
    expect(fullHeight).toBeGreaterThan(halfHeight);
  });

  it('clamps a reading outside 0..1 rather than drawing outside the basin', () => {
    const over = render(<VaultSigil vaultId={A} fill={4} />);
    const overHeight = Number(level(over.container)?.getAttribute('height'));
    cleanup();
    const full = render(<VaultSigil vaultId={A} fill={1} />);
    expect(overHeight).toBe(Number(level(full.container)?.getAttribute('height')));
  });
});

describe('what it announces', () => {
  it('is decorative unless it is the only name the thing has', () => {
    const { container } = render(<VaultSigil vaultId={A} />);
    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('carries the label it was given, and stops being decorative', () => {
    const { container } = render(<VaultSigil vaultId={A} title="Heron's vault" />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('aria-label')).toBe("Heron's vault");
    expect(svg?.getAttribute('aria-hidden')).toBeNull();
  });
});
