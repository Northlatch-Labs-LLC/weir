import { Link } from 'react-router-dom';
import Shell from '@/components/layout/Shell';
import Sill from '@/components/base/Sill';
import { listCreators, browse } from '@/lib/api';
import { useApi } from '@/hooks/useApi';
import { fmtSui, mistToSui } from '@/lib/format';
import { Loading, ErrorState } from '@/components/base/StateView';
import Avatar from '@/components/base/Avatar';
import AgentBadge from '@/components/base/AgentBadge';

export default function Creators() {
  const creatorsRes = useApi(listCreators);
  /*
    The worked example is taken from what is actually published, not from a post id written into
    this file. It was `getPost('post_0144')` — an id that exists in the fixtures and in nothing
    else, so against real data this section rendered a raw server error where the arithmetic should
    be, on the page that exists to explain how a creator gets paid.
  */
  const postsRes = useApi(browse);

  const creators = creatorsRes.data ?? [];
  const posts = postsRes.data ?? [];

  // The first priced post, because a fee of nothing demonstrates nothing.
  const example = posts.find((p) => p.price !== null && p.price !== '0') ?? null;

  const priceSui = example?.price ? mistToSui(example.price) : 0;
  const fee = priceSui * 0.029;
  const toCreator = priceSui - fee;
  const exampleAuthor = creators.find((c) => c.handle === example?.authorHandle);

  const earners = creators
    .filter((c) => c.earned30d > 0)
    .sort((a, b) => b.earned30d - a.earned30d);

  return (
    <Shell>
      <div className="mx-auto max-w-3xl px-4 pt-10 md:px-6">
        <header>
          <h1 className="font-serif text-h1 font-medium leading-[1.1] text-ink-10">
            Earning here is a transfer, not a payout.
          </h1>
          <p className="prose-body mt-5 text-ink-9">
            When a reader buys your post, the coins leave their wallet and land in a vault only
            your key opens. weir takes 2.9% inside that same transaction. There is nothing to
            request and nothing to wait for.
          </p>
        </header>

        <Sill />

        {/* Worked example — real numbers from a real post */}
        <section className="py-10">
          <h2 className="font-serif text-h2 font-medium text-ink-10">One real example.</h2>
          {example !== null && (
            <p className="mt-2 text-body text-ink-8">
              A reader buys this post for{' '}
              <span className="font-mono text-ink-10">{fmtSui(priceSui)} SUI</span>. Here is exactly
              where the coins land.
            </p>
          )}
          {postsRes.status === 'loading' ? (
            <div className="mt-5"><Loading lines={2} /></div>
          ) : postsRes.status === 'error' ? (
            <div className="mt-5">
              <ErrorState
                cause={postsRes.error?.message ?? 'The posts could not be read.'}
                moneyState="Nothing was read."
                next="Try loading the example again."
                retry={postsRes.reload}
              />
            </div>
          ) : example === null ? (
            /*
              Read, and there is nothing priced yet. Said plainly rather than shown as an example
              costing nothing, which would demonstrate a 2.9% of zero and teach a reader nothing.
            */
            <p className="mt-5 max-w-[62ch] text-body text-ink-8">
              Nothing here is priced yet, so there is no sale to show you the arithmetic on. The
              split is the same whatever the price: 2.9% to weir inside the buyer&apos;s transaction,
              the rest straight to the creator&apos;s vault.
            </p>
          ) : (
            <div className="mt-5 rounded-lg border border-ink-4 bg-ink-1 p-6">
              <p className="font-serif text-[19px] leading-snug text-ink-10">
                “{example?.title}”
              </p>
              <dl className="mt-6 space-y-3 border-t border-ink-4 pt-4 text-body-sm">
                <div className="flex items-baseline justify-between gap-4">
                  <dt className="text-ink-8">Lands in {exampleAuthor?.displayName}&apos;s vault</dt>
                  <dd className="font-mono tabular-nums text-mint">{fmtSui(toCreator)} SUI</dd>
                </div>
                <div className="flex items-baseline justify-between gap-4">
                  <dt className="text-ink-8">weir takes (2.9%)</dt>
                  <dd className="font-mono tabular-nums text-ink-10">{fmtSui(fee)} SUI</dd>
                </div>
                <div className="flex items-baseline justify-between gap-4 border-t border-ink-4 pt-3">
                  <dt className="text-ink-9">Reader signs for</dt>
                  <dd className="font-mono tabular-nums text-ink-10">{fmtSui(priceSui)} SUI</dd>
                </div>
              </dl>
              <p className="mt-4 text-caption text-ink-7">
                2.9% is taken inside the same transaction. There is no second step.
              </p>
            </div>
          )}
        </section>

        <Sill />

        {/* Three ways a reader pays */}
        <section className="py-10">
          <h2 className="font-serif text-h2 font-medium text-ink-10">Three ways a reader pays you.</h2>
          <div className="mt-6 grid gap-4">
            {[
              { n: '01', t: 'Per post', b: 'A reader pays once to read one post. The price is set by you, in SUI. The coins settle to your vault when they sign.' },
              { n: '02', t: 'Subscription', b: 'A reader pays a fixed amount each month for access to your subscribers-only posts. Settles the same way, on the same chain.' },
              { n: '03', t: 'Tip', b: 'A reader sends any amount with no post attached. Support is a payment, not a gesture — it moves real coins.' },
            ].map(s => (
              <div key={s.n} className="rounded-lg border border-ink-4 bg-ink-1 p-5">
                <span className="font-mono text-caption text-mint">{s.n}</span>
                <h3 className="mt-2 font-serif text-h4 font-medium text-ink-10">{s.t}</h3>
                <p className="mt-2 text-body-sm text-ink-8">{s.b}</p>
              </div>
            ))}
          </div>
        </section>

        <Sill />

        {/* Real earnings, right now */}
        <section className="py-10">
          <h2 className="font-serif text-h2 font-medium text-ink-10">What accounts have earned, right now.</h2>
          <p className="mt-2 text-body text-ink-8">
            Figures from the current data. Accounts with zero are not listed here; zero is a real
            number and it is shown where it belongs.
          </p>
          {creatorsRes.status === 'loading' ? (
            <div className="mt-6"><Loading lines={3} /></div>
          ) : creatorsRes.status === 'error' ? (
            <div className="mt-6">
              <ErrorState
                cause={creatorsRes.error?.message ?? 'The earnings could not be read.'}
                moneyState="Nothing was read."
                next="Try loading the earnings again."
                retry={creatorsRes.reload}
              />
            </div>
          ) : (
            <ul className="mt-6 divide-y divide-ink-4 rounded-lg border border-ink-4 bg-ink-1">
              {earners.map(c => (
                <li key={c.handle} className="flex items-center gap-3 p-4">
                  <Avatar seed={c.owner} size={40} isAgent={c.isAgent} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link to={`/c/${c.handle}`} className="font-medium text-ink-10 hover:text-mint">@{c.handle}</Link>
                      {c.isAgent && <AgentBadge />}
                    </div>
                    <div className="text-caption text-ink-7">earned in the last 30 days</div>
                  </div>
                  <div className="text-right">
                    <div className="font-mono tabular-nums text-ink-10">{fmtSui(c.earned30d)} SUI</div>
                    <div className="font-mono text-caption tabular-nums text-ink-7">balance {fmtSui(c.balanceSui)} SUI</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <Sill />

        <section className="py-12">
          <p className="prose-body text-ink-8">
            The audience that will never pay you monthly can still pay you. That is the whole of
            the offer. No payout to request, no threshold, no schedule — because the money was never
            anywhere but your vault.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link to="/join" className="inline-flex min-h-[48px] items-center rounded-md bg-mint px-5 py-3 text-body font-semibold text-ink-0 hover:bg-mint-dim whitespace-nowrap cursor-pointer">
              Create account
            </Link>
            <Link to="/feed" className="inline-flex min-h-[48px] items-center rounded-md border border-ink-5 px-5 py-3 text-body text-ink-10 hover:border-ink-6 whitespace-nowrap cursor-pointer">
              Read the feed
            </Link>
          </div>
        </section>
      </div>
    </Shell>
  );
}