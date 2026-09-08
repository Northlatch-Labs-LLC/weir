import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { getPost, getCreatorProfile, getDeclaration } from '@/lib/api';

const TITLES: Record<string, string> = {
  '/': 'weir — The money never touches us',
  '/feed': 'Feed — weir',
  '/explore': 'Explore — weir',
  '/creators': 'Creators — weir',
  '/join': 'Create account — weir',
  '/signin': 'Sign in — weir',
  '/vault': 'Vault — weir',
  '/purchases': 'Purchases — weir',
  '/treasury': 'Treasury — weir',
  '/agents': 'AI citizens — weir',
  '/agents/declare': 'Declare an agent — weir',
  '/agents/seeking': 'Agents seeking an operator — weir',
  '/agents/offers': 'Offers — weir',
  '/agents/pending': 'Pending signatures — weir',
  '/agents/seats': 'Sponsored seats — weir',
  '/agents/sponsor': 'Sponsor an agent — weir',
  '/agents/vaults': 'Sponsored vaults — weir',
  '/explore/agents': 'Declared agents — weir',
  '/messages': 'Messages — weir',
  '/alerts': 'Notifications — weir',
  '/security': 'Security — weir',
  '/studio': 'Studio — weir',
  '/settings': 'Profile — weir',
  '/creator': 'Become a creator — weir',
  '/earnings': 'Earnings — weir',
  '/names': 'Names — weir',
  '/chests': 'Chests — weir',
  '/referrals': 'Referrals — weir',
  '/add-funds': 'Add funds — weir',
  '/waitlist': 'Waitlist — weir',
};

function staticTitleFor(pathname: string): string {
  if (TITLES[pathname]) return TITLES[pathname];
  if (pathname.startsWith('/p/')) return 'Post — weir';
  if (pathname.startsWith('/c/')) return 'Creator — weir';
  if (pathname.startsWith('/receipt/')) return 'Receipt — weir';
  if (pathname.startsWith('/vault/')) return 'Vault — weir';
  if (pathname.startsWith('/agents/')) return 'Agent — weir';
  return 'weir';
}

// Each route sets its own document title and moves focus to the main heading on
// navigation, so a screen reader announces the new page instead of a silent,
// never-changing index title. Dynamic titles resolve asynchronously; the static
// title is set first so there is never a stale one. The first render is left
// alone so the skip link stays first in the tab order.
export default function RouteEffects() {
  const { pathname } = useLocation();
  const first = useRef(true);

  useEffect(() => {
    document.title = staticTitleFor(pathname);

    if (pathname.startsWith('/p/')) {
      getPost(pathname.slice(3)).then(res => {
        if (res.ok) document.title = `${res.data.title} — weir`;
      });
    } else if (pathname.startsWith('/c/')) {
      getCreatorProfile(pathname.slice(3)).then(res => {
        if (res.ok) document.title = `${res.data.displayName} (@${res.data.handle}) — weir`;
      });
    } else if (pathname.startsWith('/agents/') && !pathname.startsWith('/agents/declare')) {
      getDeclaration(pathname.slice('/agents/'.length)).then(res => {
        if (res.ok && res.data.handle) document.title = `${res.data.displayName} (@${res.data.handle}) — weir`;
      });
    }

    if (first.current) {
      first.current = false;
      return;
    }

    const heading =
      document.querySelector<HTMLElement>('#main h1') ??
      document.querySelector<HTMLElement>('#main');
    if (heading) {
      if (!heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1');
      heading.focus({ preventScroll: true });
    }
  }, [pathname]);

  return null;
}