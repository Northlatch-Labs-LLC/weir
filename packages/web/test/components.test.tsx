// @vitest-environment happy-dom
// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
/**
 * The two components that decide what a reader believes about a creator.
 *
 * `EntityType`
 * tells a reader whether clicking through will take their money or hold a deposit they get back.
 * Both are small, both are pure, and both are wrong in ways that do not throw:
 *
 *   A `Creator` marker on a vault selling nothing sends a reader to a page with nothing to buy.
 *   A missing `Free support` marker hides the one thing this product does that competitors do not.
 *
 * None of those raise an error. They render, and they are believed.
 */

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { EntityType, entitiesOf } from '../components/EntityType';

afterEach(cleanup);

describe('deciding what a profile is', () => {
  it('a vault with tiers sells memberships', () => {
    expect(entitiesOf({ tiers: 2 })).toEqual(['creator']);
  });

  it('a vault with no tiers sells nothing yet', () => {
    // Marking it as a membership would send a reader to a page with nothing to buy. The vault
    // existing is not the same as the vault being open for business.
    expect(entitiesOf({ tiers: 0 })).toEqual(['user']);
  });

  it('a stake vault means free support', () => {
    expect(entitiesOf({ tiers: 0, stakeVaultId: '0xabc' })).toEqual(['free-support']);
  });

  it('both apply at once, which is the arrangement this platform is for', () => {
    expect(entitiesOf({ tiers: 3, stakeVaultId: '0xabc' })).toEqual([
      'creator',
      'free-support',
    ]);
  });

  it('an empty stake vault id is not a stake vault', () => {
    // A blank column is absence, not a vault at address "".
    expect(entitiesOf({ tiers: 0, stakeVaultId: '' })).toEqual(['user']);
    expect(entitiesOf({ tiers: 0, stakeVaultId: null })).toEqual(['user']);
  });

  it('never returns an empty list, so a name always carries something', () => {
    expect(entitiesOf({}).length).toBeGreaterThan(0);
  });

  it('does not add "user" alongside a real marker', () => {
    // Two markers where one says nothing takes the room the useful one needs.
    expect(entitiesOf({ tiers: 1, stakeVaultId: '0xabc' })).not.toContain('user');
  });
});

describe('the entity markers a reader sees', () => {
  it.each([
    ['creator', 'Creator'],
    ['free-support', 'Free support'],
    ['user', 'User'],
  ] as const)('%s is labelled "%s"', (entity, label) => {
    render(<EntityType entity={entity} />);
    expect(screen.getByText(label)).toBeTruthy();
  });

  it('says what happens to your money, not what object it is', () => {
    /*
     * The distinction the whole component exists for. "StakeVault" teaches a reader nothing;
     * "deposit and keep it" is the fact they need before clicking. Confusing free support with a
     * membership is the most expensive mistake available here, in both directions.
     */
    const { container } = render(<EntityType entity="free-support" />);
    const title = container.querySelector('.entity')?.getAttribute('title') ?? '';
    expect(title).toMatch(/keep it|withdraw/i);
    expect(title).not.toMatch(/vault|object/i);
  });

  it('warns that a membership payment is final', () => {
    const { container } = render(<EntityType entity="creator" />);
    expect(container.querySelector('.entity')?.getAttribute('title') ?? '').toMatch(/final/i);
  });

  it('gives each type its own class, so colour can carry the meaning', () => {
    // Colour is the fastest signal in a feed. Three types sharing a class would make them one.
    const seen = new Set<string>();
    for (const entity of ['creator', 'free-support', 'user'] as const) {
      const { container } = render(<EntityType entity={entity} />);
      seen.add(container.querySelector('.entity')?.className ?? '');
      cleanup();
    }
    expect(seen.size).toBe(3);
  });
});
