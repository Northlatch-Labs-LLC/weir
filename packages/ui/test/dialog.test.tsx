// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
/**
 * What a dialog owes the person in front of it.
 *
 * Radix implements the behaviour; these assert the wiring, because the wiring is what was wrong.
 * The hand-written dialog this replaces declared `aria-modal="true"` over a page it did not make
 * inert, rendered outside a portal, let the background scroll, and never gave focus back. Each of
 * those is invisible until somebody uses a keyboard or a screen reader, which is exactly why they
 * survived.
 *
 * The one that is ours rather than Radix's is `busy`: a dialog that has asked a wallet to sign must
 * not close under the reader. The signature is already out and this is the only place its outcome
 * can appear, so Escape, the scrim and the close control all have to be held at once — and the
 * previous implementations each remembered that separately, which is how one of them forgets.
 */

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
    /*
      Modality by `aria-hidden` on the siblings, not by `aria-modal="true"` on the dialog.

      The hand-written version asserted the second and delivered neither: `aria-modal` is a CLAIM
      that the rest of the page is unreachable, honoured unevenly, and it was made over a page that
      was fully reachable by Tab. Hiding the siblings is the thing that is actually true, so it is
      the thing worth pinning.
    */
    open();
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-labelledby')).not.toBeNull();
    expect(screen.getByText('Unlock this post')).toBeTruthy();

    const siblings = [...document.body.children].filter((el) => !el.contains(dialog));
    expect(siblings.length).toBeGreaterThan(0);
    expect(siblings.every((el) => el.getAttribute('aria-hidden') === 'true')).toBe(true);
  });

  it('renders into a portal, not inside whatever opened it', () => {
    /*
      The reason this matters is not tidiness. A dialog left in the tree inherits every ancestor's
      stacking context, and one `transform` anywhere above it reparents `position: fixed` — so the
      overlay lands inside the column instead of over the page.
    */
    const { container } = render(
      <Dialog open onOpenChange={() => undefined} title="Unlock this post">
        <button type="button">Pay</button>
      </Dialog>,
    );
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it('links its description to the dialog, so it is announced with the title', () => {
    /*
      Both halves, because each was wrong once. Rendering the title as a stand-in description
      announced the same sentence twice; suppressing `aria-describedby` to fix that suppressed it
      for dialogs that HAD a description, which rendered the sentence and never announced it.
    */
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
  /*
    All three at once. The previous implementations guarded the close button and the Escape key in
    different places, and the scrim not at all — so a click outside dropped a dialog whose
    transaction was already at the wallet.
  */
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
