'use client';
// Built-by: @projectx.sui · Co-authored-by: Claude
/**
 * The footer, once.
 *
 * Three short columns — the product, the account, what it is built on — and the line that invites a
 * stranger to verify us. The nine-link "Product" list it replaces pointed "Feed" at `/` and offered
 * a waiting list on a site that was open; both lists now come from `lib/site-map.ts`.
 *
 * The package ids are fetched rather than compiled in: this codebase ships no `NEXT_PUBLIC_`
 * variable, deliberately, and `app/api/zklogin/session` states why. Until the answer arrives the
 * line says so rather than inventing a digest.
 */
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Icon } from '@/components/design/icons';
import { FOOTER } from '@/lib/site-map';
import { WeirMark } from '@/components/shell/SiteHeader';


/**
 * Where to follow the work, off site.
 *
 * Three channels and no more: Weir's own voice on X, the organisation's code on GitHub, and the
 * agent's own account on Moltbook, the forum whose members are AI agents. The handles are the
 * ones the estate publishes under — the account that posts as Weir on X, the organisation every
 * repository here lives in, and the Moltbook author of every post we have made there — so a reader
 * who follows any of them lands on us and not on a lookalike. Shown in every state, gated
 * included: a shut door still says where we are.
 */
// SOCIAL moved to lib/social-links.ts on 2026-09-06 — see that file for why.
export { SOCIAL } from '@/lib/social-links';
import { SOCIAL } from '@/lib/social-links';

interface Deployment {
  packageId: string;
  explorer: string;
  latestPackageId: string;
  latestExplorer: string;
}

export function SiteFooter({ gated = false }: { gated?: boolean }) {
  const [deployment, setDeployment] = useState<Deployment | null>(null);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch('/api/deployment');
        if (!response.ok) return;
        const body = (await response.json()) as Record<string, unknown>;
        if (cancelled) return;
        const { packageId, explorer, latestPackageId, latestExplorer } = body;
        // All four or none: the original id alone is the exact defect the pair was introduced to fix.
        if (
          typeof packageId === 'string' &&
          typeof explorer === 'string' &&
          typeof latestPackageId === 'string' &&
          typeof latestExplorer === 'string'
        ) {
          setDeployment({ packageId, explorer, latestPackageId, latestExplorer });
        }
      } catch {
        // Unreachable: the line stays in its unmeasured state, which is the truth.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  const short = (id: string) => `${id.slice(0, 6)}…${id.slice(-4)}`;

  return (
    <footer className="sf">
      <div className="sf__inner">
        <div className="sf__brand">
          <span className="sf__tile" aria-hidden>
            <WeirMark size={22} />
          </span>
          <div>
            <p className="sf__word">weir</p>
            <p className="sf__tag">Your favorite notification.</p>
          </div>
        </div>
        {/* A shut door lists only what the proxy lets through. */}
        {!gated && (
        <nav aria-label="Product" className="sf__col">
          <p className="sf__k">Product</p>
          {FOOTER.product.map((d) => (
            <Link key={d.href} href={d.href} className="sf__link">
              <Icon name={d.icon} size={14} />
              {d.label}
            </Link>
          ))}
        </nav>
        )}
        <nav aria-label="Account links" className="sf__col">
          <p className="sf__k">Account</p>
          {(gated ? FOOTER.gated : FOOTER.account).map((d) => (
            <Link key={d.href} href={d.href} className="sf__link">
              <Icon name={d.icon} size={14} />
              {d.label}
            </Link>
          ))}
        </nav>
        {/*
          Legal, on every page and in every state — gated included. The information a provider must
          display is not something a closed door excuses, and these are the pages a reader is most
          likely to want precisely when the rest of the site is unavailable to them.
        */}
        <nav aria-label="Legal" className="sf__col">
          <p className="sf__k">Legal</p>
          {FOOTER.legal.map((d) => (
            <Link key={d.href} href={d.href} className="sf__link">
              <Icon name={d.icon} size={14} />
              {d.label}
            </Link>
          ))}
        </nav>
        {/* The partner marks moved to /security, where the notes can be read. */}
      </div>
      <div className="sf__foot">
        <p className="sf__verify">
          {deployment === null ? (
            <>Verify everything on chain. The package ids are loading.</>
          ) : (
            <>
              Verify everything on chain: package{' '}
              <a href={deployment.explorer} rel="noreferrer" target="_blank" className="mono">
                {short(deployment.packageId)}
              </a>
              {deployment.latestPackageId !== deployment.packageId && (
                <>
                  {' '}
                  · latest{' '}
                  <a href={deployment.latestExplorer} rel="noreferrer" target="_blank" className="mono">
                    {short(deployment.latestPackageId)}
                  </a>
                </>
              )}
            </>
          )}
        </p>
        {/*
          The company, and where to find us off site.

          The accounts were a sixth footer column. They are three links and they belong on one line
          — but each one still prints its handle, because that is what lets a reader tell our
          account from a lookalike before they click. Losing the handle would lose the only part of
          that column that was doing work.
        */}
        <nav aria-label="Follow" className="sf__family">
          {SOCIAL.map((s) => (
            <a key={s.href} href={s.href} rel="noreferrer" target="_blank">
              {s.name} <span className="sf__note">{s.handle}</span>
            </a>
          ))}
          <span>© Northlatch Labs LLC</span>
        </nav>
      </div>
    </footer>
  );
}
