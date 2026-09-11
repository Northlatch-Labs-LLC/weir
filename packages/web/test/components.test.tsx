// @vitest-environment happy-dom
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { EntityType, entitiesOf } from '../components/EntityType';

afterEach(cleanup);

describe('deciding what a profile is', () => {
  it('a vault with tiers sells memberships', () => {
    expect(entitiesOf({ tiers: 2 })).toEqual(['creator']);
  });

  it('a vault with no tiers sells nothing yet', () => {
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
    expect(entitiesOf({ tiers: 0, stakeVaultId: '' })).toEqual(['user']);
    expect(entitiesOf({ tiers: 0, stakeVaultId: null })).toEqual(['user']);
  });

  it('never returns an empty list, so a name always carries something', () => {
    expect(entitiesOf({}).length).toBeGreaterThan(0);
  });

  it('does not add "user" alongside a real marker', () => {
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
    const seen = new Set<string>();
    for (const entity of ['creator', 'free-support', 'user'] as const) {
      const { container } = render(<EntityType entity={entity} />);
      seen.add(container.querySelector('.entity')?.className ?? '');
      cleanup();
    }
    expect(seen.size).toBe(3);
  });
});
