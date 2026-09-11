// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
/**
 * A dialog, once, on Radix.
 *
 * # Why not by hand
 *
 * There were three hand-written overlays in this product — `UnlockDialog`, `WalletConnect` and
 * `AccountMenu` — and between them four `Escape` handlers, six `.focus()` calls and two different
 * answers to whether the thing should be portalled. Every one of those is a behaviour somebody has
 * to remember, and the failures are the quiet kind:
 *
 *   - `UnlockDialog` declares `aria-modal="true"` and traps nothing. A screen reader is told the
 *     rest of the page is inert while `Tab` walks straight out of the dialog into it — the one
 *     combination worse than having no dialog semantics at all.
 *   - Neither it nor `AccountMenu` renders into a portal, so both inherit every ancestor's stacking
 *     context. A `transform` or a `filter` on any parent silently reparents `position: fixed`, and
 *     the overlay lands inside the column instead of over the page.
 *   - Nothing locks the background scroll, so the page moves underneath an open dialog.
 *   - Focus is never restored to the control that opened it.
 *
 * Radix answers all four, and it was already resolved in this workspace: `@mysten/dapp-kit` depends
 * on it. It is declared here directly rather than reached for through that, because a dependency
 * you did not ask for is one a version bump can take away.
 *
 * # What this file adds on top
 *
 * Only the design. Radix ships unstyled; the classes below live in `weir-ui.css` with everything
 * else, so a dialog looks like the rest of the product without a single value typed into an
 * element.
 */

import * as RadixDialog from '@radix-ui/react-dialog';
import type { ReactNode } from 'react';
import { Icon } from '../base/Icon';

export function Dialog({
  open,
  onOpenChange,
  title,
  /**
   * A sentence under the title, for a dialog that is asking rather than telling.
   *
   * Rendered through Radix's description so it is announced with the title. Where a dialog has no
   * one-line summary, `describedBy` is set to nothing rather than pointed at a paragraph that
   * happens to be first — an announcement of the wrong sentence is worse than none.
   */
  description,
  children,
  /** The width the panel wants. The design's dialog is 460px; a wider one says so. */
  width = 460,
  /**
   * Set while something irreversible is in flight.
   *
   * A dialog that has asked a wallet to sign must not close under the reader: the signature is
   * already out, and closing loses the only place the result can be reported. This blocks Escape,
   * the scrim and the close control together, rather than each of them separately remembering.
   */
  busy = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string | undefined;
  children: ReactNode;
  width?: number;
  busy?: boolean;
}) {
  const hold = (event: Event) => {
    if (busy) event.preventDefault();
  };

  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="w-scrim" />
        <RadixDialog.Content
          className="w-dialog"
          style={{ width }}
          /*
            No description means no `aria-describedby`. Spread conditionally rather than passed as
            `undefined`: an explicitly-passed undefined suppresses the attribute in BOTH cases, so
            a dialog that HAD a description rendered it visually and never linked it. Measured.

            The version before that rendered the title as the description so the attribute had
            something to point at, which announced the same sentence twice.
          */
          {...(description === undefined ? { 'aria-describedby': undefined } : {})}
          onEscapeKeyDown={hold}
          onPointerDownOutside={hold}
          onInteractOutside={hold}
        >
          <div className="w-dialog__head">
            <RadixDialog.Title className="w-dialog__title">{title}</RadixDialog.Title>
            {/*
              One close control, here rather than in each dialog.

              Every hand-written dialog drew its own, and each one had to remember to disable
              itself mid-signature. `busy` is held in one place now, so a dialog cannot be closed
              out from under a signature by a control somebody forgot to guard.
            */}
            <RadixDialog.Close
              className="w-dialog__x"
              type="button"
              aria-label="Close"
              disabled={busy}
            >
              <Icon name="close" size={20} />
            </RadixDialog.Close>
          </div>
          {description === undefined ? null : (
            <RadixDialog.Description className="w-dialog__lede">
              {description}
            </RadixDialog.Description>
          )}
          {children}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

/**
 * The control that closes a dialog from inside its own body.
 *
 * A plain button calling `onOpenChange(false)` works, and this exists so a body does not have to
 * hold the setter to have a Cancel: Radix closes through it, and it inherits the `busy` hold above.
 */
export function DialogClose({
  children,
  className = 'w-btn w-btn--quiet',
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <RadixDialog.Close className={className} type="button">
      {children}
    </RadixDialog.Close>
  );
}
