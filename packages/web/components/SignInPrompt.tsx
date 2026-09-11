'use client';
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

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
