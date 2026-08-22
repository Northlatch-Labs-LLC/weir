'use client';
// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
/**
 * The phone's bottom bar.
 *
 * Four destinations under the thumb, visible below 760px only (the switch is in `weir.css`). A
 * guest gets the front of the product — Feed, Explore, Creators, Sign in. A member gets their own
 * things — Feed, Explore, Alerts, and "Me", which is their page when they have one and their
 * purchases when they do not.
 *
 * It is a `nav` with `aria-current`, like every other list of links here, and it reserves its own
 * height at the foot of the page (`.weir-shell` padding) so it never covers the last line of a post.
 */
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon } from '@/components/design/icons';
import { isHere, type Destination } from '@/lib/site-map';

export function MobileBar({
  signedIn,
  myHandle,
  gated = false,
}: {
  signedIn: boolean;
  myHandle: string | null;
  /** The door is shut: only the two destinations the proxy lets through. */
  gated?: boolean;
}) {
  const pathname = usePathname() ?? '/';
  const me: Destination =
    myHandle !== null
      ? { href: `/c/${myHandle}`, label: 'Me', icon: 'name' }
      : { href: '/purchases', label: 'Me', icon: 'unlock' };
  const items: readonly Destination[] = gated
    ? [
        { href: '/waitlist', label: 'Waiting list', icon: 'drop' },
        { href: '/signin', label: 'Sign in', icon: 'key' },
      ]
    : signedIn
    ? [
        { href: '/feed', label: 'Feed', icon: 'waves' },
        { href: '/explore', label: 'Explore', icon: 'compass' },
        { href: '/alerts', label: 'Alerts', icon: 'bell' },
        me,
      ]
    : [
        { href: '/feed', label: 'Feed', icon: 'waves' },
        { href: '/explore', label: 'Explore', icon: 'compass' },
        { href: '/creators', label: 'Creators', icon: 'users' },
        { href: '/signin', label: 'Sign in', icon: 'key' },
      ];
  return (
    <nav aria-label="Quick" className="mbar" data-gated={gated ? '' : undefined}>
      {items.map((d) => (
        <Link
          key={d.href}
          href={d.href}
          className="mbar__link"
          aria-current={isHere(d.href, pathname) ? 'page' : undefined}
        >
          <Icon name={d.icon} size={20} />
          <span>{d.label}</span>
        </Link>
      ))}
    </nav>
  );
}
