'use client';
// Built-by: @projectx.sui /|\ · Co-authored-by: Claude

/**
 * A one-line way in, for a control that needs an address.
 *
 * # Why not the sign-in panel
 *
 * `SignIn` renders every way in — a wallet list, the notices for wallets that cannot be offered,
 * and the reason when none is installed. That is right for a page devoted to signing in and wrong
 * beside a comment box: a feed of six posts rendered three of them, so a reader scrolling was
 * offered the same wallet list over and over between other people's writing.
 *
 * The header now carries a connect button on every screen, so an inline copy is not the only route
 * — it is repetition. This says what the control needs and where to get it, in one line.
 *
 * # It carries where the reader was
 *
 * `next` is the current path, so signing in returns them to the post they were reading rather than
 * to the top of the feed. Losing your place is a small thing that reads as the site having
 * forgotten what you were doing.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function SignInPrompt({ action }: { action: string }) {
  const pathname = usePathname();
  const next = pathname === '/signin' ? '/signin' : `/signin?next=${encodeURIComponent(pathname)}`;

  return (
    <p className="signin-prompt">
      <Link href={next}>Sign in</Link> to {action}.
    </p>
  );
}
