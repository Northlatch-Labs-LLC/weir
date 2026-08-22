'use client';
// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
/**
 * The member rail.
 *
 * # What it lists, and where the list lives
 *
 * Everything an account holds — the feed, messages, alerts, purchases, the support vault, referrals
 * — and, for a creator, the studio. The list is `lib/site-map.ts`; this file only decides which
 * parts of it apply to the person signed in and draws them in sections, so the rail reads as a map
 * rather than as eleven links of equal weight.
 *
 * # Membership is derived from chain, never from a flag
 *
 * There is no creator role anywhere — not on chain, not in the database. A vault is an object you
 * happen to own, so "creator" is something you *are* by holding one. `undefined` is the third state
 * and the important one: not looked up yet, or the read failed. The rail grows when the answer
 * arrives and never shrinks on a failure, because hiding a creator's own tools because a node was
 * slow tells them they are not a creator.
 *
 * Layout lives in `weir.css`. This has to be a column beside the content on a desktop and a
 * scrolling strip under the header on a phone, which is precisely the thing inline styles cannot
 * express.
 */
import { useEffect, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useSigner } from '@/components/SignerProvider';
import { Icon } from '@/components/design/icons';
import { ADMIN, CREATOR, JOIN, MEMBER, isHere, type Destination } from '@/lib/site-map';

export function AppNav() {
  const pathname = usePathname() ?? '/';
  const searchParams = useSearchParams();
  const reader = searchParams.get('reader');
  const withReader = (href: string) =>
    reader === null ? href : `${href}${href.includes('?') ? '&' : '?'}reader=${reader}`;

  const { signer } = useSigner();
  const [stage, setStage] = useState<'no-account' | 'no-vault' | 'ready' | undefined>(undefined);
  const [isAdmin, setIsAdmin] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    const address = signer?.address;
    if (address === undefined) {
      setStage(undefined);
      setIsAdmin(undefined);
      return;
    }
    let cancelled = false;
    setStage(undefined);
    setIsAdmin(undefined);
    void fetch(`/api/creator?owner=${encodeURIComponent(address)}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { stage?: 'no-account' | 'no-vault' | 'ready' } | null) => {
        if (cancelled || body?.stage === undefined) return;
        setStage(body.stage);
      })
      .catch(() => undefined);
    void fetch(`/api/admin?address=${encodeURIComponent(address)}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { isAdmin?: boolean } | null) => {
        if (cancelled || body?.isAdmin === undefined) return;
        setIsAdmin(body.isAdmin);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [signer?.address]);

  const groups: { title: string; links: readonly Destination[] }[] = [
    { title: 'You', links: MEMBER },
    ...(stage === 'ready' ? [{ title: 'Creator studio', links: CREATOR }] : []),
    ...(isAdmin === true ? [{ title: 'Platform', links: [ADMIN] }] : []),
    ...(signer === null || stage === 'no-account' ? [{ title: 'Get started', links: [JOIN] }] : []),
  ];

  return (
    <nav aria-label="Account" className="weir-appnav">
      {groups.map((group) => (
        <div key={group.title} className="weir-appnav__group">
          <p className="weir-appnav__kicker">{group.title}</p>
          <div className="weir-appnav__row">
            {group.links.map((link) => (
              <Link
                key={link.href}
                href={withReader(link.href)}
                /* `aria-current` rather than colour alone: "which page am I on" must survive being
                   read aloud, and must not depend on distinguishing crest from grey. */
                aria-current={isHere(link.href, pathname) ? 'page' : undefined}
                className="weir-appnav__link"
              >
                <Icon name={link.icon} size={15} />
                {link.label}
              </Link>
            ))}
          </div>
        </div>
      ))}
    </nav>
  );
}
