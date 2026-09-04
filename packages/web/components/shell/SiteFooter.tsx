'use client';
// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
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
 * The partners' own marks, from `public/brand/built-on/` — the same files the feed and the rail
 * show. This footer is on every page a visitor can reach, including the waiting list, so it is
 * where the marks are actually seen; the letter `mark` is the fallback when no file is supplied.
 */
const BUILT_ON = [
  { name: 'Sui', mark: 'S', note: 'Settlement', href: 'https://sui.io', logo: '/brand/built-on/sui-icon.png' },
  { name: 'Walrus', mark: 'W', note: 'Post bodies and media', href: 'https://www.walrus.xyz', logo: '/brand/built-on/walrus-icon.png' },
  { name: 'Seal', mark: 'SL', note: 'Releases the key to paid media', href: 'https://seal-docs.wal.app', logo: '/brand/built-on/seal-icon.png' },
  { name: 'zkLogin', mark: 'zk', note: 'Sign in with Google', href: 'https://docs.sui.io/concepts/cryptography/zklogin', logo: '/brand/built-on/zklogin-icon.png' },
  { name: 'USDC', mark: '$', note: 'One of two denominations', href: 'https://www.circle.com/usdc' },
] as const;

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
export const SOCIAL = [
  { name: 'X', handle: '@weirsocial', mark: 'X', href: 'https://x.com/weirsocial' },
  { name: 'GitHub', handle: 'Northlatch-Labs-LLC', mark: 'GH', href: 'https://github.com/Northlatch-Labs-LLC' },
  { name: 'Moltbook', handle: '@weirsocial', mark: 'M', href: 'https://www.moltbook.com/u/weirsocial' },
] as const;

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
        <nav aria-label="Built on" className="sf__col">
          <p className="sf__k">Built on</p>
          {BUILT_ON.map((b) => (
            <a key={b.name} href={b.href} className="sf__link" rel="noreferrer" target="_blank">
              <span className="sf__mark" aria-hidden>
                {'logo' in b ? (
                  <img src={b.logo} alt="" width={18} height={18} style={{ width: '1.125rem', height: '1.125rem', objectFit: 'contain', display: 'block' }} />
                ) : (
                  b.mark
                )}
              </span>
              {b.name}
              <span className="sf__note">{b.note}</span>
            </a>
          ))}
        </nav>
        <nav aria-label="Follow" className="sf__col">
          <p className="sf__k">Follow</p>
          {SOCIAL.map((s) => (
            <a key={s.href} href={s.href} className="sf__link" rel="noreferrer" target="_blank">
              <span className="sf__mark" aria-hidden>{s.mark}</span>
              {s.name}
              <span className="sf__note">{s.handle}</span>
            </a>
          ))}
        </nav>
      </div>
      <div className="sf__foot">
        <p className="sf__verify">
          {deployment === null ? (
            <>Verify everything on chain — package ids load from the server.</>
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
          The operating entity, and an on-site link. It used to link off-site; what the contracts
          are is answered one link along, by `/security` and by the package ids above.
        */}
        <p className="sf__family">
          © Northlatch Labs LLC · <Link href="/security">Security</Link>
        </p>
      </div>
    </footer>
  );
}
