import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import Shell from '@/components/layout/Shell';
import { useViewer } from '@/lib/viewer-context';
import { searchName, listOwnedNames, claimName, pointName, type NameLookup } from '@/lib/api';
import { useApi } from '@/hooks/useApi';
import { fmtMist, shortAddress } from '@/lib/format';
import SignedOutGate from '@/components/base/SignedOutGate';
import Icon from '@/components/base/Icon';
import { Loading, ErrorState, EmptyState } from '@/components/base/StateView';

export default function Names() {
  const { viewer } = useViewer();
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [lookup, setLookup] = useState<NameLookup | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [claimedName, setClaimedName] = useState<string | null>(null);
  const [pointing, setPointing] = useState<string | null>(null);

  const ownedRes = useApi(listOwnedNames, [viewer.signedIn, viewer.address]);

  const doSearch = async (e?: FormEvent<HTMLFormElement>) => {
    e?.preventDefault();
    const clean = query.trim();
    if (!clean) {
      setLookup(null);
      setSearchError('Enter a name to search.');
      return;
    }
    setSearching(true);
    setSearchError(null);
    setClaimError(null);
    setClaimedName(null);
    const res = await searchName(clean);
    setSearching(false);
    if (res.ok) setLookup(res.data);
    else {
      setLookup(null);
      setSearchError(res.error.message);
    }
  };

  const doClaim = async () => {
    if (!lookup) return;
    setClaiming(true);
    setClaimError(null);
    const res = await claimName(lookup.name);
    setClaiming(false);
    if (res.ok) {
      setClaimedName(res.data.name);
      setLookup({ ...lookup, available: false, priceMist: null });
      ownedRes.reload();
    } else {
      setClaimError(res.error.message);
    }
  };

  const doPoint = async (name: string) => {
    setPointing(name);
    const res = await pointName(name);
    setPointing(null);
    if (res.ok) ownedRes.reload();
  };

  return (
    <Shell>
      <div className="mx-auto max-w-3xl px-4 pt-10 md:px-6">
        <header>
          <h1 className="font-serif text-h1 font-medium leading-[1.1] text-ink-10">Names</h1>
          <p className="prose-body mt-5 text-ink-9">
            A name here is an object on chain that its owner holds, so it is theirs to keep, move or
            sell. Search a name, see whether it is available and what it costs, and claim it.
          </p>
        </header>

        <section className="mt-8">
          <form onSubmit={doSearch} noValidate>
            <label htmlFor="name-search" className="block text-body-sm text-ink-9">Find a name</label>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="relative flex-1">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-7">@</span>
                <input
                  id="name-search"
                  name="name"
                  type="text"
                  value={query}
                  maxLength={32}
                  onChange={e => setQuery(e.target.value)}
                  aria-invalid={searchError ? true : undefined}
                  aria-describedby={searchError ? 'name-search-error' : undefined}
                  className="w-full rounded-md border border-ink-5 bg-ink-2 py-2 pl-7 pr-3 text-body text-ink-10 placeholder:text-ink-7"
                  placeholder="yourname"
                />
              </div>
              <button
                type="submit"
                disabled={searching}
                className="inline-flex min-h-[44px] shrink-0 items-center gap-2 rounded-md bg-mint px-5 py-2 text-body-sm font-semibold text-ink-0 hover:bg-mint-dim disabled:opacity-60 whitespace-nowrap cursor-pointer"
              >
                <Icon name="search" size={15} />
                Search
              </button>
            </div>
            <div className="mt-1 text-caption text-ink-7">{query.length}/32</div>
          </form>

          {searchError && (
            <p id="name-search-error" className="mt-2 text-body-sm text-rose" role="alert">
              {searchError}
            </p>
          )}

          {searching ? (
            <div className="mt-5"><Loading lines={1} /></div>
          ) : lookup ? (
            <div className="mt-5 rounded-lg border border-ink-4 bg-ink-1 p-5">
              <div className="flex flex-wrap items-center gap-3">
                <span className="font-mono text-h3 text-ink-10">@{lookup.name}</span>
                {lookup.available ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-mint bg-mint/10 px-3 py-1 text-caption font-medium text-mint">
                    <Icon name="check" size={13} />
                    Available
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-ink-5 bg-ink-2 px-3 py-1 text-caption text-ink-8">
                    Taken
                  </span>
                )}
              </div>

              {lookup.available ? (
                <div className="mt-4 flex flex-wrap items-center gap-4">
                  <span className="text-body text-ink-8">
                    Price{' '}
                    <span className="font-mono tabular-nums text-mint">{fmtMist(lookup.priceMist)} SUI</span>
                  </span>
                  {viewer.signedIn ? (
                    <button
                      type="button"
                      onClick={doClaim}
                      disabled={claiming}
                      className="inline-flex min-h-[44px] items-center gap-2 rounded-md bg-mint px-5 py-2 text-body-sm font-semibold text-ink-0 hover:bg-mint-dim disabled:opacity-60 whitespace-nowrap cursor-pointer"
                    >
                      <Icon name="check" size={15} />
                      {claiming ? 'Claiming…' : 'Claim this name'}
                    </button>
                  ) : (
                    <Link
                      to="/signin"
                      className="inline-flex min-h-[44px] items-center gap-2 rounded-md border border-ink-5 bg-ink-2 px-5 py-2 text-body-sm text-ink-10 hover:border-ink-6 whitespace-nowrap cursor-pointer"
                    >
                      Sign in to claim
                    </Link>
                  )}
                </div>
              ) : null}

              {claimError && (
                <p className="mt-3 text-body-sm text-rose" role="alert">{claimError}</p>
              )}
              {claimedName && (
                <p className="mt-3 text-body-sm text-mint" role="status">
                  You now own @{claimedName}.
                </p>
              )}
            </div>
          ) : null}
        </section>

        {viewer.signedIn ? (
          <section className="mt-10">
            <h2 className="text-caption font-semibold uppercase tracking-wide text-ink-7">Your names</h2>
            {ownedRes.status === 'loading' ? (
              <div className="mt-4"><Loading lines={2} /></div>
            ) : ownedRes.status === 'error' ? (
              <div className="mt-4">
                <ErrorState
                  cause={ownedRes.error?.message ?? 'Your names could not be read.'}
                  moneyState="Nothing was read."
                  next="Try loading your names again."
                  retry={ownedRes.reload}
                />
              </div>
            ) : !ownedRes.data || ownedRes.data.length === 0 ? (
              <div className="mt-4"><EmptyState seed="names-empty" fact="No names yet." /></div>
            ) : (
              <ul className="mt-4 divide-y divide-ink-4 rounded-lg border border-ink-4 bg-ink-1">
                {ownedRes.data.map(n => {
                  const pointed = n.pointsTo === viewer.address;
                  return (
                    <li
                      key={n.name}
                      className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0">
                        <div className="font-mono text-body text-ink-10">@{n.name}</div>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-caption text-ink-7">
                          {pointed ? (
                            <span className="inline-flex items-center gap-1 text-mint">
                              <Icon name="check" size={13} />
                              Points to your account
                            </span>
                          ) : (
                            <span>Not pointed</span>
                          )}
                          <span>owner {shortAddress(n.owner)}</span>
                        </div>
                      </div>
                      {pointed ? null : (
                        <button
                          type="button"
                          onClick={() => doPoint(n.name)}
                          disabled={pointing === n.name}
                          className="inline-flex min-h-[44px] shrink-0 items-center gap-2 rounded-md border border-ink-5 bg-ink-2 px-4 py-2 text-body-sm text-ink-10 hover:border-ink-6 disabled:opacity-60 whitespace-nowrap cursor-pointer"
                        >
                          <Icon name="settings" size={15} />
                          Point to your account
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        ) : (
          <section className="mt-10">
            <SignedOutGate what="Your names are the ones you own. Sign in to see and manage them." next="names" />
          </section>
        )}
      </div>
    </Shell>
  );
}