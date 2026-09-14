// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { Stepper, type Step } from '../src/base/Stepper';

const STEPS: readonly Step[] = [
  { id: 'account', label: 'Account' },
  { id: 'handle', label: 'Handle' },
  { id: 'claim', label: 'Claim' },
];

afterEach(cleanup);

describe('the stepper', () => {
  it('names every step, so the reader sees what is still ahead of them', () => {
    render(<Stepper steps={STEPS} current={1} />);
    for (const step of STEPS) expect(screen.getByText(step.label)).toBeTruthy();
  });

  it('marks exactly one step as current, and it is the one asked for', () => {
    const { container } = render(<Stepper steps={STEPS} current={2} />);
    const current = container.querySelectorAll('[aria-current="step"]');
    expect(current.length).toBe(1);
    expect(current[0]?.textContent).toContain('Handle');
  });

  it('settles the steps behind the reader and leaves the ones ahead open', () => {
    const { container } = render(<Stepper steps={STEPS} current={3} />);
    expect(container.querySelectorAll('.w-stepper__step--done').length).toBe(2);
    expect(container.querySelectorAll('.w-stepper__step--current').length).toBe(1);
    expect(container.querySelectorAll('.w-stepper__step--ahead').length).toBe(0);
  });

  it('a settled step shows a tick where its number was', () => {
    const { container } = render(<Stepper steps={STEPS} current={2} />);
    const marks = [...container.querySelectorAll('.w-stepper__mark')].map((m) => m.textContent);
    expect(marks).toEqual(['✓', '2', '3']);
  });

  it('on the first step nothing is settled yet', () => {
    const { container } = render(<Stepper steps={STEPS} current={1} />);
    expect(container.querySelectorAll('.w-stepper__step--done').length).toBe(0);
    expect(container.querySelectorAll('.w-stepper__step--ahead').length).toBe(2);
  });

  it('is an ordered list, so it is announced as a sequence without being told to', () => {
    const { container } = render(<Stepper steps={STEPS} current={1} label="Creating your account" />);
    const list = container.querySelector('ol');
    expect(list).toBeTruthy();
    expect(list?.getAttribute('aria-label')).toBe('Creating your account');
    expect(list?.querySelectorAll('li').length).toBe(3);
  });

  it('the last step draws no rule, so the row does not end on a line going nowhere', () => {
    const { container } = render(<Stepper steps={STEPS} current={1} />);
    expect(container.querySelectorAll('.w-stepper__rule').length).toBe(STEPS.length - 1);
  });
});
