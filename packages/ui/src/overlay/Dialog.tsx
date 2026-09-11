// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import * as RadixDialog from '@radix-ui/react-dialog';
import type { ReactNode } from 'react';
import { Icon } from '../base/Icon';

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  width = 460,
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
          {...(description === undefined ? { 'aria-describedby': undefined } : {})}
          onEscapeKeyDown={hold}
          onPointerDownOutside={hold}
          onInteractOutside={hold}
        >
          <div className="w-dialog__head">
            <RadixDialog.Title className="w-dialog__title">{title}</RadixDialog.Title>
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
