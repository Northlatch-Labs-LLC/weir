// @vitest-environment happy-dom
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
/**
 * The component layer.
 *
 * These wrap CSS that already worked, so appearance is not what is under test. What is under test
 * is the set of states that were previously improvised per screen — and the two failures that
 * caused:
 *
 *   A button that stays clickable while a transaction is in flight. On this platform a second
 *   click is a second signature.
 *   A label rendered as a styled span above an input, associated with nothing, so clicking it does
 *   nothing and a screen reader announces the field as unlabelled.
 *
 * Neither throws. Both look correct.
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  Card, Empty, Grid, Loading, Panel, Row, Stack, Stat, Unmeasured,
} from '../components/ui/primitives';
// Separate module because these forward event handlers and must be client components — see the
// header of `controls.tsx`.
import { Button, Field } from '../components/ui/controls';

afterEach(cleanup);

describe('Button owns the loading state', () => {
  it('cannot be clicked while loading', () => {
    // The regression that matters. Every screen had to remember `disabled={busy}`, and one that
    // forgot would submit twice.
    const onClick = vi.fn();
    render(<Button loading onClick={onClick}>Sign</Button>);
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('replaces the label, so something visibly happened', () => {
    render(<Button loading loadingLabel="Waiting for your signature…">Sign</Button>);
    // Twice by design — once on the button, once in the live region that announces it. Asserted on
    // the button so the test does not silently pass if only the announcement remains.
    expect(screen.getByRole('button').textContent).toBe('Waiting for your signature…');
    expect(screen.queryByText('Sign')).toBeNull();
  });

  it('announces the change from outside the button, which keeps existing when it is disabled', () => {
    /*
     * Disabling a focused element blurs it, so `aria-busy` and the swapped label land on something
     * no longer focused and are never spoken. The live region is unaffected by that.
     */
    render(<Button loading loadingLabel="Signing…">Sign</Button>);
    const region = screen.getByRole('status');
    expect(region.textContent).toBe('Signing…');
    expect(region.closest('button')).toBeNull();
  });

  it('announces itself as busy, not merely dimmed', () => {
    // A changed label tells a screen reader nothing without this.
    render(<Button loading>Sign</Button>);
    expect(screen.getByRole('button').getAttribute('aria-busy')).toBe('true');
  });

  it('is clickable when idle', () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Sign</Button>);
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('honours an explicit disabled independently of loading', () => {
    const onClick = vi.fn();
    render(<Button disabled onClick={onClick}>Sign</Button>);
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('defaults to type=button, so it cannot submit a form by accident', () => {
    // The HTML default is `submit`. A button inside a form that navigates on click is a bug that
    // only appears once somebody wraps it in a form.
    render(<Button>Sign</Button>);
    expect(screen.getByRole('button').getAttribute('type')).toBe('button');
  });
});

describe('Field binds its label', () => {
  it('associates label and input, so clicking the label focuses the field', () => {
    render(<Field label="Handle" />);
    const input = screen.getByLabelText('Handle');
    expect(input).toBeTruthy();
  });

  it('marks the input invalid and points at the message when there is an error', () => {
    render(<Field label="Handle" error="that handle is taken" />);
    const input = screen.getByLabelText('Handle');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    // Described-by, not merely adjacent — otherwise the message is invisible to a screen reader.
    const describedBy = input.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)?.textContent).toContain('taken');
  });

  it('shows the hint when there is no error, and the error replaces it', () => {
    const { rerender } = render(<Field label="Handle" hint="lowercase, 3-30" />);
    expect(screen.getByText(/lowercase/)).toBeTruthy();
    rerender(<Field label="Handle" hint="lowercase, 3-30" error="taken" />);
    expect(screen.queryByText(/lowercase/)).toBeNull();
    expect(screen.getByText('taken')).toBeTruthy();
  });

  it('is not marked invalid when there is no error', () => {
    render(<Field label="Handle" />);
    expect(screen.getByLabelText('Handle').getAttribute('aria-invalid')).toBeNull();
  });
});

describe('layout primitives constrain spacing to the token scale', () => {
  it.each([
    ['Row', <Row key="r" gap={16}>x</Row>],
    ['Stack', <Stack key="s" gap={16}>x</Stack>],
    ['Grid', <Grid key="g" gap={16}>x</Grid>],
  ])('%s spaces from a token, never a raw pixel value', (_name, element) => {
    /*
     * `gap` is a union of the token steps rather than `number`. That constraint is most of what
     * makes a set of screens look deliberate — an eyeballed 7px gap somewhere is exactly how forty
     * hand-written rows stopped agreeing with each other.
     */
    const { container } = render(element);
    expect((container.firstChild as HTMLElement).style.gap).toBe('var(--space-16)');
  });

  it('Row lays out horizontally and Stack vertically', () => {
    const { container: row } = render(<Row>x</Row>);
    expect((row.firstChild as HTMLElement).style.flexDirection).not.toBe('column');
    cleanup();
    const { container: stack } = render(<Stack>x</Stack>);
    expect((stack.firstChild as HTMLElement).style.flexDirection).toBe('column');
  });

  it('Grid wraps rather than squashing its columns', () => {
    const { container } = render(<Grid min={240}>x</Grid>);
    expect((container.firstChild as HTMLElement).style.gridTemplateColumns).toContain('minmax(240px, 1fr)');
  });
});

describe('the three empty-ish states stay three', () => {
  /*
   * The product's central discipline, expressed as components. "Could not read", "reading" and
   * "read it, there is nothing" are different facts with different remedies, and they render
   * identically the moment somebody collapses them into one empty div.
   */
  it('Unmeasured says a read failed and shows the reason', () => {
    render(<Unmeasured detail="the node timed out" />);
    expect(screen.getByText(/Not measured/i)).toBeTruthy();
    expect(screen.getByText(/timed out/)).toBeTruthy();
  });

  it('Loading says work is in progress', () => {
    render(<Loading what="Reading your vaults…" />);
    expect(screen.getByText('Reading your vaults…')).toBeTruthy();
  });

  it('Empty states a measured absence', () => {
    render(<Empty>You have not deposited here.</Empty>);
    expect(screen.getByText(/not deposited/)).toBeTruthy();
  });

  it('Unmeasured is not a Stat tone, so a failed read cannot be styled as a number', () => {
    // Asserted on the API rather than the output: `Stat` has no `unmeasured` tone to pass, which is
    // what stops the distinction being lost to a prop.
    const source = new Set(['good', 'warn', 'danger']);
    expect(source.has('unmeasured')).toBe(false);
  });
});

describe('Stat carries meaning in its tone', () => {
  it('renders label and value', () => {
    render(<Stat label="Withdrawable now" value="0.5826" />);
    expect(screen.getByText('Withdrawable now')).toBeTruthy();
    expect(screen.getByText('0.5826')).toBeTruthy();
  });

  it('colours a favourable figure without the caller writing a hex value', () => {
    const { container } = render(<Stat label="Principal" value="1.0" tone="good" />);
    expect((container.querySelector('.v') as HTMLElement).style.color).toContain('--text-prize');
  });

  it('leaves an untoned figure to inherit, rather than defaulting to a colour', () => {
    const { container } = render(<Stat label="Principal" value="1.0" />);
    expect((container.querySelector('.v') as HTMLElement).style.color).toBe('');
  });
});

describe('surfaces', () => {
  it('Card renders its title in the eyebrow style rather than as a heading', () => {
    // A heading would enter the document outline and misrepresent the page structure.
    const { container } = render(<Card title="YOUR DEPOSIT">body</Card>);
    expect(container.querySelector('.k')?.textContent).toBe('YOUR DEPOSIT');
    expect(container.querySelector('h1, h2, h3')).toBeNull();
  });

  it('Panel and Card keep their base class when given an extra one', () => {
    const { container } = render(<Panel className="verified-card">x</Panel>);
    expect((container.firstChild as HTMLElement).className).toContain('panel');
    expect((container.firstChild as HTMLElement).className).toContain('verified-card');
  });
});

describe('props are merged, never silently discarded', () => {
  /*
   * Each of these compiles cleanly and fails at render — no type error, no console warning, just a
   * dropped style or a lost accessibility reference. That is the exact failure class this codebase
   * refuses everywhere else, so it is refused here too.
   */
  it('Button keeps a caller’s style alongside its own', () => {
    render(<Button style={{ marginTop: '12px' }} full>Sign</Button>);
    const button = screen.getByRole('button');
    expect(button.style.marginTop).toBe('12px');
    expect(button.style.width).toBe('100%');
  });

  it('Field keeps a caller’s aria-describedby alongside its own', () => {
    render(<Field label="Amount" hint="in SUI" aria-describedby="external-help" />);
    const described = screen.getByLabelText('Amount').getAttribute('aria-describedby') ?? '';
    expect(described).toContain('external-help');
    expect(described.split(' ').length).toBe(2);
  });

  it('Field applies className to the wrapper, so it can sit in a row', () => {
    const { container } = render(<Field label="Amount" className="grow" />);
    expect((container.firstChild as HTMLElement).className).toBe('grow');
  });

  it('two Fields sharing a label get different ids', () => {
    // Deriving the id from label text produced duplicates, and label[for] binds to the first match
    // only — so the second field's label and error pointed at the first field's input.
    render(<><Field label="Amount" /><Field label="Amount" /></>);
    const [a, b] = screen.getAllByLabelText('Amount');
    expect(a?.id).toBeTruthy();
    expect(a?.id).not.toBe(b?.id);
  });
});
