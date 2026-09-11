// @vitest-environment happy-dom
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { PostBody } from '../components/PostBody';

afterEach(cleanup);

describe('offering the control', () => {
  it('offers "Read more" when the body says more than the excerpt', () => {
    render(<PostBody preview="The opening." body="The opening. And then a great deal more." />);
    expect(screen.getByRole('button', { name: /Read more/i })).toBeTruthy();
  });

  it('offers nothing when the body is the excerpt', () => {
    const { container } = render(<PostBody preview="All of it." body="All of it." />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(container.innerHTML).toBe('');
  });

  it('ignores whitespace differences when deciding', () => {
    render(<PostBody preview={'All  of it.'} body={'All of it.\n'} />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('offers nothing for an empty body', () => {
    render(<PostBody preview="Excerpt" body="   " />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('opening and closing', () => {
  it('keeps the body out of the document until asked, then shows it and a way back', () => {
    const { container } = render(<PostBody preview="Short." body="Short. Then the whole story." />);
    expect(container.querySelector('.post-body')).toBeNull();

    const open = screen.getByRole('button', { name: /Read more/i });
    expect(open.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(open);

    const close = screen.getByRole('button', { name: /Show less/i });
    expect(close.getAttribute('aria-expanded')).toBe('true');
    const body = container.querySelector('.post-body');
    expect(body?.textContent).toBe('Short. Then the whole story.');
    expect(close.hasAttribute('aria-controls')).toBe(false);
    expect(container.querySelector('.post-body-wrap')?.hasAttribute('data-open')).toBe(true);

    fireEvent.click(close);
    expect(container.querySelector('.post-body')).toBeNull();
    expect(screen.getByRole('button', { name: /Read more/i })).toBeTruthy();
  });
});
