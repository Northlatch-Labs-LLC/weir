// @vitest-environment happy-dom
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
/**
 * The gate is checked elsewhere; this is about what is rendered once somebody is through it. The
 * test that matters is the last one: an email address must not reach the DOM by any path, including
 * a `title`, an `aria-label` or a key. The type has nowhere to put one and no query selects one —
 * this is the third lock, on the surface itself, because that is where a leak would actually be
 * read by somebody.
 */
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { WaitlistInsightPanel } from '../components/WaitlistInsight';
import { fillDays, type WaitlistInsight } from '../lib/waitlist-insight';

afterEach(cleanup);

const AUG_21 = Date.UTC(2026, 7, 21, 12, 0, 0);

const insight = (over: Partial<WaitlistInsight> = {}): WaitlistInsight => ({
  total: 12,
  withHandle: 5,
  viaReferral: 3,
  byRole: [
    { key: 'supporter', count: 7 },
    { key: 'creator', count: 4 },
    { key: 'both', count: 1 },
  ],
  bySource: [
    { key: 'waitlist', count: 9 },
    { key: 'hero', count: 3 },
    { key: 'closing', count: 0 },
    { key: 'footer', count: 0 },
  ],
  daily: fillDays([{ day: '2026-08-21', count: 2 }], AUG_21, 30),
  topReferrers: [{ handle: 'ada', code: 'ABCD1234', referred: 3 }],
  recent: [
    { handle: 'ada', code: 'ABCD1234', role: 'creator', source: 'waitlist', joinedAtMs: AUG_21, referred: false },
    { handle: null, code: 'ZZ99XY01', role: 'supporter', source: 'hero', joinedAtMs: AUG_21, referred: true },
    { handle: null, code: null, role: 'both', source: 'footer', joinedAtMs: AUG_21, referred: false },
  ],
  ...over,
});

describe('the panel reports what was measured', () => {
  it('shows the three headline counts', () => {
    const { container } = render(<WaitlistInsightPanel insight={insight()} />);
    const text = container.textContent ?? '';
    expect(text).toContain('On the list');
    expect(text).toContain('12');
    expect(text).toContain('Asked for a handle');
    expect(text).toContain('Came via a link');
  });

  it('names people by handle, and by code when there is no handle', () => {
    const { container } = render(<WaitlistInsightPanel insight={insight()} />);
    const text = container.textContent ?? '';
    expect(text).toContain('@ada');
    expect(text).toContain('ZZ99XY01');
  });

  it('says plainly that a row has no name rather than inventing one', () => {
    const { container } = render(<WaitlistInsightPanel insight={insight()} />);
    expect(container.textContent).toContain('no handle, no code');
  });

  it('draws a column for every day in the window, quiet ones included', () => {
    const { container } = render(<WaitlistInsightPanel insight={insight()} />);
    // Every column carries its own `title`, so 30 days is 30 titled bars whatever the counts are.
    const bars = container.querySelectorAll('div[title*="2026-"]');
    expect(bars).toHaveLength(30);
  });
});

describe('an unread list is not an empty one', () => {
  it('renders "not measured" for null, and does not report zero signups', () => {
    const { container } = render(<WaitlistInsightPanel insight={null} />);
    const text = container.textContent ?? '';
    expect(text).toContain('Not measured');
    expect(text).not.toContain('On the list');
  });

  it('renders an honest empty state when the list really is empty', () => {
    const { container } = render(
      <WaitlistInsightPanel
        insight={insight({ total: 0, withHandle: 0, viaReferral: 0, topReferrers: [], recent: [] })}
      />,
    );
    const text = container.textContent ?? '';
    expect(text).toContain('Nobody has joined the list yet.');
    expect(text).toContain('Nobody has arrived through a shared link yet.');
  });
});

describe('no email address reaches the page', () => {
  it('renders none, even when every row is carrying one alongside', () => {
    /*
      The rows are given extra fields the type does not declare — exactly what a careless future
      query would hand this component. Nothing may render them, so a leak has to be an added
      element rather than an accident of spreading a row into the DOM.
    */
    const leaky = insight({
      recent: [
        {
          handle: 'ada',
          code: 'ABCD1234',
          role: 'creator',
          source: 'waitlist',
          joinedAtMs: AUG_21,
          referred: false,
          ...({ email: 'ada@example.com' } as Record<string, unknown>),
        },
      ],
      topReferrers: [
        { handle: 'ada', code: 'ABCD1234', referred: 3, ...({ email: 'ada@example.com' } as Record<string, unknown>) },
      ],
    });
    const { container } = render(<WaitlistInsightPanel insight={leaky} />);

    // Not in the text, and not in any attribute either — a `title` is as readable as a cell.
    expect(container.innerHTML).not.toContain('ada@example.com');
    expect(container.innerHTML).not.toContain('example.com');
    expect(container.innerHTML).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
  });

  it('says on screen that it is not showing them', () => {
    const { container } = render(<WaitlistInsightPanel insight={insight()} />);
    expect(container.textContent).toContain('no email address is shown on this page');
  });
});
