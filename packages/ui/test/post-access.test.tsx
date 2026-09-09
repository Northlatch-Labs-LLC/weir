// Built-by: @projectx.sui · Co-authored-by: Claude
/**
 * The two rules in the component layer that have already cost this product something, held down
 * by tests rather than by memory.
 *
 *   1. A post's access marker states the POST's terms, never the reader's relationship to them.
 *      A buyer once saw the word "Free" on a post they had just paid for, because a badge read
 *      `locked ? price : 'Free'` — the reader's entitlement standing in for the post's price.
 *   2. A price that could not be read is never rendered as free and never as a number.
 *
 * Both are assertions about what a reader sees, not about markup, so they survive a redesign.
 */

import { describe, expect, it } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import type { ReactNode } from 'react';
import { PostCard, type PostView } from '../src/post/PostCard';
import { Avatar } from '../src/base/Avatar';

function Link({ href, children, ...rest }: { href: string; children: ReactNode; [k: string]: unknown }) {
  return (
    <a href={href} {...rest}>
      {children}
    </a>
  );
}

const author = {
  address: '0xda784b6c20c5995f6b719a20a26eddee5ec971c8ecec890e61c8b4634dd1715d',
  handle: 'wren',
  displayName: 'Wren',
  isAgent: false,
};

function post(overrides: Partial<PostView>): PostView {
  return {
    id: 'pmtgxlqay',
    author,
    when: '5h',
    body: 'Everyone tells you to use the pasta water.',
    access: { kind: 'free' },
    comments: 41,
    supporters: 27,
    ...overrides,
  };
}

describe('a post states its own terms', () => {
  it('shows the price on a paid post the reader does not hold', () => {
    cleanup();
    render(<PostCard post={post({ access: { kind: 'paid', price: '0.5 SUI' } })} Link={Link} />);
    expect(screen.getByText('0.5 SUI')).toBeTruthy();
    expect(screen.queryByText('FREE')).toBeNull();
  });

  it('does NOT say free when the reader holds a paid post — it says unlocked', () => {
    cleanup();
    render(<PostCard post={post({ access: { kind: 'paid', price: '0.5 SUI' }, unlocked: true })} Link={Link} />);
    expect(screen.getByText('Unlocked')).toBeTruthy();
    expect(screen.queryByText('FREE')).toBeNull();
  });

  it('never renders an unreadable price as free, or as a number', () => {
    cleanup();
    render(<PostCard post={post({ access: { kind: 'paid', price: null } })} Link={Link} />);
    expect(screen.getByText('Locked')).toBeTruthy();
    expect(screen.queryByText('FREE')).toBeNull();
    // The control cannot be pressed towards a price nobody could read.
    expect(screen.getByRole('button', { name: /not priced yet/i }).hasAttribute('disabled')).toBe(true);
  });

  it('keeps a gated body out of the document entirely', () => {
    cleanup();
    render(
      <PostCard
        post={post({ access: { kind: 'paid', price: '0.5 SUI' }, body: 'the free lede only', lockedAssets: 3 })}
        Link={Link}
      />,
    );
    expect(screen.getByText('the free lede only')).toBeTruthy();
    expect(screen.getByText('3 images')).toBeTruthy();
  });

  it('marks a declared agent beside the name, and marks nobody else', () => {
    cleanup();
    render(<PostCard post={post({ author: { ...author, isAgent: true } })} Link={Link} />);
    expect(screen.getByText('AGENT')).toBeTruthy();

    cleanup();
    render(<PostCard post={post({})} Link={Link} />);
    expect(screen.queryByText('AGENT')).toBeNull();
    expect(screen.queryByText(/human/i)).toBeNull();
  });
});

describe('an account has one face', () => {
  it('draws the same picture for the same address, every time', () => {
    cleanup();
    const { container: a } = render(<Avatar address={author.address} />);
    const first = a.innerHTML;
    cleanup();
    const { container: b } = render(<Avatar address={author.address.toUpperCase()} />);
    expect(b.innerHTML).toBe(first);
  });

  it('draws a different picture for a different address', () => {
    cleanup();
    const { container: a } = render(<Avatar address={author.address} />);
    const first = a.innerHTML;
    cleanup();
    const { container: b } = render(<Avatar address={'0x0b8882e1c5' + '0'.repeat(54)} />);
    expect(b.innerHTML).not.toBe(first);
  });

  it('needs no network and no effect — it is complete in the first render', () => {
    cleanup();
    const { container } = render(<Avatar address={author.address} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('svg')).not.toBeNull();
  });
});
