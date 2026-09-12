// @vitest-environment happy-dom
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

let pathname = '/c/heron';
vi.mock('next/navigation', () => ({ usePathname: () => pathname }));

const { Wall } = await import('../components/app/Wall');

afterEach(cleanup);

describe('the wall a stranger meets', () => {
  it('shows the two doors, create first, and carries the way back', () => {
    pathname = '/c/heron';
    render(<Wall why="Tipping needs an account." />);
    const create = screen.getByText('Create account').closest('a');
    const signin = screen.getByText('Sign in').closest('a');
    expect(create?.getAttribute('href')).toBe('/join?next=%2Fc%2Fheron');
    expect(signin?.getAttribute('href')).toBe('/signin?next=%2Fc%2Fheron');
    expect(create!.compareDocumentPosition(signin!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText('Tipping needs an account.')).toBeTruthy();
  });

  it('does not send a door back to itself', () => {
    pathname = '/signin';
    render(<Wall />);
    expect(screen.getByText('Create account').closest('a')?.getAttribute('href')).toBe('/join');
    expect(screen.getByText('Sign in').closest('a')?.getAttribute('href')).toBe('/signin');
  });
});
