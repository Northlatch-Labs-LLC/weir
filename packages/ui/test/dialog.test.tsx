// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { Dialog, DialogClose } from '../src/overlay/Dialog';

afterEach(cleanup);

function open(props: Partial<Parameters<typeof Dialog>[0]> = {}) {
  const onOpenChange = vi.fn();
  render(
    <Dialog open onOpenChange={onOpenChange} title="Unlock this post" {...props}>
      <button type="button">Pay</button>
      <DialogClose>Cancel</DialogClose>
    </Dialog>,
  );
  return onOpenChange;
}

describe('a dialog announces itself correctly', () => {
  it('is named by its title, and takes the rest of the page out of the accessibility tree', () => {
    open();
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-labelledby')).not.toBeNull();
    expect(screen.getByText('Unlock this post')).toBeTruthy();

    const siblings = [...document.body.children].filter((el) => !el.contains(dialog));
    expect(siblings.length).toBeGreaterThan(0);
    expect(siblings.every((el) => el.getAttribute('aria-hidden') === 'true')).toBe(true);
  });

  it('renders into a portal, not inside whatever opened it', () => {
    const { container } = render(
      <Dialog open onOpenChange={() => undefined} title="Unlock this post">
        <button type="button">Pay</button>
      </Dialog>,
    );
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it('links its description to the dialog, so it is announced with the title', () => {
    open({ description: 'It stays yours once bought.' });
    const id = screen.getByRole('dialog').getAttribute('aria-describedby');
    expect(id).not.toBeNull();
    expect(document.getElementById(id as string)?.textContent).toBe('It stays yours once bought.');
  });

  it('points at nothing when there is no description, rather than at its own title', () => {
    open();
    expect(screen.getByRole('dialog').getAttribute('aria-describedby')).toBeNull();
    expect(screen.getAllByText('Unlock this post')).toHaveLength(1);
  });
});

describe('closing', () => {
  it('closes on Escape', () => {
    const onOpenChange = open();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('closes from the control in its own body', () => {
    const onOpenChange = open();
    screen.getByText('Cancel').click();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('offers one close control, and it is labelled', () => {
    open();
    expect(screen.getByLabelText('Close')).toBeTruthy();
  });
});

describe('a signature in flight holds the dialog open', () => {
  it('refuses Escape', () => {
    const onOpenChange = open({ busy: true });
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('disables the close control rather than hiding it', () => {
    open({ busy: true });
    const close = screen.getByLabelText('Close') as HTMLButtonElement;
    expect(close.disabled).toBe(true);
  });

  it('is closable again once the signature is done', () => {
    const onOpenChange = open({ busy: false });
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
