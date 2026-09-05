// @vitest-environment happy-dom
// Built-by: @projectx.sui · Co-authored-by: Claude
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { PostBody } from '../components/PostBody';

/*
  The body is a fold. Closed, the card is the excerpt and nothing else; "Read more" opens the body
  in place and "Show less" closes it. The only judgement the component makes is whether there is
  anything to open.
*/

afterEach(cleanup);

describe('offering the control', () => {
  it('offers "Read more" when the body says more than the excerpt', () => {
    render(<PostBody preview="The opening." body="The opening. And then a great deal more." />);
    expect(screen.getByRole('button', { name: /Read more/i })).toBeTruthy();
  });

  it('offers nothing when the body is the excerpt', () => {
    // A control that reveals what is already on the screen teaches the reader it does nothing.
    const { container } = render(<PostBody preview="All of it." body="All of it." />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(container.innerHTML).toBe('');
  });

  it('ignores whitespace differences when deciding', () => {
    // Expressions, not attribute strings: JSX attributes do not process escapes.
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
    // The control names what it opens.
    expect(close.getAttribute('aria-controls')).toBe(body?.id);
    expect(container.querySelector('.post-body-wrap')?.hasAttribute('data-open')).toBe(true);

    fireEvent.click(close);
    expect(container.querySelector('.post-body')).toBeNull();
    expect(screen.getByRole('button', { name: /Read more/i })).toBeTruthy();
  });
});
