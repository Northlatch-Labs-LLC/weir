// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
/**
 * The search box has to be able to search.
 *
 * It shipped as an anchor to `/explore` shaped exactly like a field: it looked like search, it was
 * where search goes, and clicking it loaded the directory with nothing to type into. Every assertion
 * here is about what somebody can do with it — type a query, send it, and find it still there when
 * the results arrive — so none of them survives it going back to being a link.
 */

import { describe, expect, it, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { SearchBox } from '../src/layout/Discovery';

afterEach(cleanup);

describe('the search box', () => {
  it('is a form with a field, not a link', () => {
    render(<SearchBox />);
    const field = screen.getByLabelText('Search Weir');
    expect(field.tagName).toBe('INPUT');
    const form = field.closest('form');
    expect(form).not.toBeNull();
    // A GET submit, so the query ends up in the URL and a result is a link somebody can send.
    expect(form?.getAttribute('method')?.toLowerCase()).toBe('get');
    expect(form?.getAttribute('action')).toBe('/explore');
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('names the field `q`, which is what the results page reads', () => {
    render(<SearchBox />);
    expect(screen.getByLabelText('Search Weir').getAttribute('name')).toBe('q');
  });

  it('still holds the query on the results page', () => {
    render(<SearchBox query="lentil" />);
    expect((screen.getByLabelText('Search Weir') as HTMLInputElement).value).toBe('lentil');
  });

  /*
    The frame puts `reader` on every link it draws. A bare form posts only its own fields, so
    without these the one control that leaves the frame outside a link would drop it — and the next
    page would be read as somebody else.
  */
  it('carries the frame state it was given, as fields rather than as text', () => {
    const { container } = render(<SearchBox hidden={{ reader: '0xabc' }} />);
    const hidden = container.querySelector('input[type="hidden"][name="reader"]');
    expect(hidden?.getAttribute('value')).toBe('0xabc');
    expect(screen.queryByText('0xabc')).toBeNull();
  });

  it('carries nothing when there is nothing to carry', () => {
    const { container } = render(<SearchBox />);
    expect(container.querySelectorAll('input[type="hidden"]')).toHaveLength(0);
  });
});
