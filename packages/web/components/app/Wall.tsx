'use client';
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/*
  What a stranger meets wherever an action needs an account: the same two doors, in the same
  order, that the rail and the public header show. `why` names the action in the product's voice
  ("to follow", "to tip") so the wall says what is on the other side of it.
*/
export function Wall({ why, compact = false }: { why?: string | undefined; compact?: boolean }) {
  const pathname = usePathname();
  const back = pathname === null || pathname === '/signin' || pathname === '/join' ? null : pathname;
  const suffix = back === null ? '' : `?next=${encodeURIComponent(back)}`;

  return (
    <p className="w-wall">
      {why === undefined ? null : <span className="w-wall__why">{why}</span>}
      <Link href={`/join${suffix}`} className={compact ? 'w-btn w-btn--primary w-btn--sm' : 'w-btn w-btn--primary'}>
        Create account
      </Link>
      <Link href={`/signin${suffix}`} className={compact ? 'w-btn w-btn--quiet w-btn--sm' : 'w-btn w-btn--quiet'}>
        Sign in
      </Link>
    </p>
  );
}
