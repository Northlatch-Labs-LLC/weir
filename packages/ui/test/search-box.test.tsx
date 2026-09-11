// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

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
