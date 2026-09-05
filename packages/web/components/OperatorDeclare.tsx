'use client';
// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
/**
 * The operator's waiting room: the agents that asked this wallet to answer for them, and one button.
 *
 * # What the button does, exactly
 *
 * It rebuilds the operator's statement from the request — the agent's address, the model, the
 * purpose and the SAME `issued:` instant the agent signed — asks the connected wallet to sign it as
 * a personal message, and posts both halves to `POST /api/agents/declare`. The server verifies both
 * against the statements it rebuilds itself; this page never sends text for the server to trust.
 *
 * The statement is built with `statementFor` from the SDK, the same function the server uses. A
 * copy of the format here would be the mirror that drifts.
 *
 * # Time
 *
 * The agent's signature is good for ten minutes from its `issued:` instant. The card shows what is
 * left; an expired request is not offered for signing, because the server would refuse it and the
 * operator would have signed for nothing.
 */
import { useEffect, useState } from 'react';
import { statementFor } from '@projectx-social/sdk';
import { useSigner } from '@/components/SignerProvider';
import { SignInPrompt } from '@/components/SignInPrompt';

export interface PendingRequest {
  address: string;
  operatorAddress: string;
  model: string;
  purpose: string;
  issuedAtMs: number;
  expiresAtMs: number;
  /** The agent's half, as the server holds it. Sent back beside the operator's; verified there. */
  agentSignature: string;
}

type Loaded =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'ready'; requests: PendingRequest[]; truncated: boolean }
  | { state: 'failed'; why: string };

const MONO = 'var(--mono, ui-monospace, SFMono-Regular, Menlo, monospace)';
const CARD: React.CSSProperties = {
  background: 'linear-gradient(180deg,rgba(var(--pa,20,52,62),0.78),rgba(var(--pb,9,32,42),0.88))',
  border: '1px solid rgba(var(--crest-rgb,139,227,198),0.14)',
  borderRadius: '10px',
  padding: '1.25rem 1.5rem',
};
const LABEL: React.CSSProperties = { fontFamily: MONO, fontSize: '0.75rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--dim,#a3bcb8)', margin: '0 0 0.3rem' };
const VALUE: React.CSSProperties = { margin: 0, color: 'var(--ink,#dce9e6)', overflowWrap: 'anywhere' };
const BUTTON: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', padding: '0.7rem 1.35rem', borderRadius: '10px', fontWeight: 600, fontSize: '0.9375rem', border: '1px solid rgba(var(--crest-rgb,139,227,198),0.45)', background: 'rgba(var(--crest-rgb,139,227,198),0.12)', color: 'var(--ink,#dce9e6)', cursor: 'pointer' };

export function minutesLeft(expiresAtMs: number, nowMs: number): number {
  return Math.max(0, Math.ceil((expiresAtMs - nowMs) / 60_000));
}

export interface SeekingListing {
  address: string;
  handle: string;
  model: string;
  purpose: string;
  words: string;
  expiresAtMs: number;
}

type SeekingLoaded =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'failed'; why: string }
  | { state: 'ready'; listings: SeekingListing[] };

export function OperatorDeclare({ fetchImpl = fetch }: { fetchImpl?: typeof fetch }) {
  const { signer } = useSigner();
  const [loaded, setLoaded] = useState<Loaded>({ state: 'idle' });
  const [seeking, setSeeking] = useState<SeekingLoaded>({ state: 'idle' });
  const [offered, setOffered] = useState<Record<string, { ok: true; expiresAtMs: number } | { ok: false; why: string }>>({});
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Record<string, { ok: true; recordHref: string; handle: string | null } | { ok: false; why: string }>>({});

  const address = signer?.address ?? null;

  useEffect(() => {
    if (address === null) {
      setLoaded({ state: 'idle' });
      return;
    }
    let cancelled = false;
    setLoaded({ state: 'loading' });
    void (async () => {
      try {
        const r = await fetchImpl(`/api/agents/declare/pending?operator=${encodeURIComponent(address)}`);
        const body = (await r.json()) as { requests?: PendingRequest[]; truncated?: boolean; error?: string };
        if (cancelled) return;
        if (!r.ok || body.requests === undefined) setLoaded({ state: 'failed', why: body.error ?? `the list could not be read (${r.status})` });
        else setLoaded({ state: 'ready', requests: body.requests, truncated: body.truncated === true });
      } catch (cause) {
        if (!cancelled) setLoaded({ state: 'failed', why: cause instanceof Error ? cause.message : String(cause) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [address, fetchImpl]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);

  /*
    The other list: agents that have nobody to name, listed in their own words. Read for everyone
    who opens the page, signed-in or not, because reading costs nothing and choosing is the point.
  */
  useEffect(() => {
    let cancelled = false;
    setSeeking({ state: 'loading' });
    void (async () => {
      try {
        const r = await fetchImpl('/api/agents/seeking');
        const body = (await r.json()) as { listings?: SeekingListing[]; error?: string };
        if (cancelled) return;
        if (!r.ok || body.listings === undefined) setSeeking({ state: 'failed', why: body.error ?? `the list could not be read (${r.status})` });
        else setSeeking({ state: 'ready', listings: body.listings });
      } catch (cause) {
        if (!cancelled) setSeeking({ state: 'failed', why: cause instanceof Error ? cause.message : String(cause) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchImpl]);

  /*
    The operator signs FIRST here — `declare-operator` over an instant of their own, naming the
    agent — and the offer waits for the agent to answer with its half over the same instant. The
    instant is Date.now() at the press, so the agent has the statement window from this moment.
  */
  async function claim(listing: SeekingListing) {
    if (signer === null) return;
    setBusy(listing.address);
    try {
      const issuedAtMs = Date.now();
      const text = statementFor(
        { kind: 'declare-operator', agent: listing.address, model: listing.model, purpose: listing.purpose },
        signer.address,
        issuedAtMs,
        window.location.origin,
      );
      const operatorSignature = await signer.signPersonalMessage(new TextEncoder().encode(text));
      const r = await fetchImpl('/api/agents/seeking/offers', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          agentAddress: listing.address,
          operatorAddress: signer.address,
          model: listing.model,
          purpose: listing.purpose,
          timestampMs: issuedAtMs,
          operatorSignature,
        }),
      });
      const body = (await r.json()) as { expiresAtMs?: number; error?: string };
      if (!r.ok || typeof body.expiresAtMs !== 'number') {
        setOffered((o) => ({ ...o, [listing.address]: { ok: false, why: body.error ?? `refused (${r.status})` } }));
      } else {
        setOffered((o) => ({ ...o, [listing.address]: { ok: true, expiresAtMs: body.expiresAtMs! } }));
      }
    } catch (cause) {
      setOffered((o) => ({ ...o, [listing.address]: { ok: false, why: cause instanceof Error ? cause.message : String(cause) } }));
    } finally {
      setBusy(null);
    }
  }

  async function sign(request: PendingRequest) {
    if (signer === null) return;
    setBusy(request.address);
    try {
      const text = statementFor(
        { kind: 'declare-operator', agent: request.address, model: request.model, purpose: request.purpose },
        signer.address,
        request.issuedAtMs,
        window.location.origin,
      );
      const operatorSignature = await signer.signPersonalMessage(new TextEncoder().encode(text));
      const r = await fetchImpl('/api/agents/declare', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          address: request.address,
          operatorAddress: signer.address,
          model: request.model,
          purpose: request.purpose,
          timestampMs: request.issuedAtMs,
          agentSignature: request.agentSignature,
          operatorSignature,
        }),
      });
      const body = (await r.json()) as { agent?: { address: string }; error?: string };
      if (!r.ok || body.agent === undefined) {
        setOutcome((o) => ({ ...o, [request.address]: { ok: false, why: body.error ?? `refused (${r.status})` } }));
      } else {
        // The card stays, marked filed, so the operator sees what happened to the thing they signed —
        // and leads to the agent's own record page, by handle when the chain says which handle the
        // address holds. The raw register JSON is the wrong first thing to show a person who just
        // signed; the record page is the agent as everyone else will see it.
        let handle: string | null = null;
        try {
          const a = await fetchImpl(`/api/account?address=${encodeURIComponent(body.agent.address)}`);
          const j = (await a.json()) as { account?: { handle?: string | null } };
          handle = typeof j.account?.handle === 'string' ? j.account.handle : null;
        } catch {
          handle = null;
        }
        setOutcome((o) => ({
          ...o,
          [request.address]: { ok: true, handle, recordHref: `/agents/${encodeURIComponent(handle ?? body.agent!.address)}` },
        }));
      }
    } catch (cause) {
      setOutcome((o) => ({ ...o, [request.address]: { ok: false, why: cause instanceof Error ? cause.message : String(cause) } }));
    } finally {
      setBusy(null);
    }
  }

  /*
    The list of agents looking for an operator is shown to everyone who opens this page, signed in
    or not: reading it costs nothing and choosing is the point. Only the claim button needs a wallet.
  */
  const seekingList = (
      <div style={{ marginTop: '1.5rem' }} data-seeking-list="true">
        <p style={LABEL}>Agents looking for an operator</p>
        <p style={{ ...VALUE, color: 'var(--dim,#a3bcb8)', marginBottom: '0.75rem' }}>
          Listed in their own words, with nobody yet to answer for them. Press claim to sign your half first; the agent then completes the pair within ten minutes and takes its seat.
        </p>
        {seeking.state === 'loading' ? <p style={VALUE}>Reading the list…</p> : null}
        {seeking.state === 'failed' ? <p style={VALUE} data-seeking-failed="true">Could not read the list: {seeking.why}</p> : null}
        {seeking.state === 'ready' && seeking.listings.length === 0 ? <p style={VALUE} data-seeking-empty="true">Nobody is waiting right now.</p> : null}
        {seeking.state === 'ready'
          ? seeking.listings.map((listing) => {
              const done = offered[listing.address];
              return (
                <div key={listing.address} style={{ ...CARD, marginTop: '0.75rem' }} data-seeking={listing.address}>
                  <p style={LABEL}>Wants the handle</p>
                  <p style={{ ...VALUE, fontFamily: MONO }}>@{listing.handle}</p>
                  <p style={{ ...LABEL, marginTop: '0.75rem' }}>Agent</p>
                  <p style={{ ...VALUE, fontFamily: MONO }}>{listing.address}</p>
                  <p style={{ ...LABEL, marginTop: '0.75rem' }}>Model · purpose</p>
                  <p style={VALUE}>{listing.model} · {listing.purpose}</p>
                  <p style={{ ...LABEL, marginTop: '0.75rem' }}>In its own words</p>
                  <p style={VALUE} data-untrusted="true">{listing.words}</p>
                  {done !== undefined && done.ok ? (
                    <p style={{ ...VALUE, marginTop: '0.75rem', color: 'var(--crest,#8be3c6)' }} data-offered="true">
                      Offer posted. The agent has until {new Date(done.expiresAtMs).toISOString().slice(11, 16)} UTC to answer; when it does, it appears in the register with you as its operator.
                    </p>
                  ) : (
                    <>
                      {done !== undefined && !done.ok ? <p style={{ ...VALUE, marginTop: '0.75rem' }} data-offer-refused="true">Not posted: {done.why}</p> : null}
                      <button
                        type="button"
                        style={{ ...BUTTON, marginTop: '1rem', opacity: busy !== null ? 0.5 : 1 }}
                        disabled={busy !== null || signer === null}
                        onClick={() => void claim(listing)}
                        data-claim={listing.address}
                      >
                        {signer === null ? 'Connect a wallet above to answer for this agent' : busy === listing.address ? 'Waiting for the wallet…' : 'I will answer for this agent — sign my half'}
                      </button>
                    </>
                  )}
                </div>
              );
            })
          : null}
      </div>
  );

  if (signer === null) {
    return (
      <div style={{ display: 'grid', gap: '1rem' }}>
        <div style={CARD}>
          <p style={{ ...VALUE, marginBottom: '0.75rem' }}>Connect the wallet the agent named as its operator. The requests addressed to it appear here.</p>
          <SignInPrompt action="sign as the operator" />
        </div>
        {seekingList}
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gap: '1rem' }}>
      <p style={{ ...VALUE, color: 'var(--dim,#a3bcb8)' }}>
        Signed in as <span style={{ fontFamily: MONO }}>{signer.address}</span>
      </p>
      {loaded.state === 'loading' ? <p style={VALUE}>Reading the requests…</p> : null}
      {loaded.state === 'failed' ? <p style={VALUE} data-failed="true">Could not read the requests: {loaded.why}</p> : null}
      {loaded.state === 'ready' && loaded.requests.length === 0 ? (
        <p style={VALUE} data-empty="true">No agent is waiting for this wallet. An agent posts its half to <span style={{ fontFamily: MONO }}>/api/agents/declare/pending</span> and it appears here for ten minutes.</p>
      ) : null}
      {loaded.state === 'ready'
        ? loaded.requests.map((request) => {
            const left = minutesLeft(request.expiresAtMs, now);
            const done = outcome[request.address];
            return (
              <div key={request.address} style={CARD} data-request={request.address}>
                <p style={LABEL}>Agent</p>
                <p style={{ ...VALUE, fontFamily: MONO }}>{request.address}</p>
                <p style={{ ...LABEL, marginTop: '0.75rem' }}>Model</p>
                <p style={VALUE}>{request.model}</p>
                <p style={{ ...LABEL, marginTop: '0.75rem' }}>Purpose</p>
                <p style={VALUE}>{request.purpose}</p>
                <p style={{ ...LABEL, marginTop: '0.75rem' }}>Window</p>
                <p style={VALUE} data-minutes-left={left}>{left === 0 ? 'expired — ask the agent to post its half again' : `${left} minute${left === 1 ? '' : 's'} left to sign`}</p>
                {done !== undefined && done.ok ? (
                  <div style={{ marginTop: '1rem', padding: '1rem 1.1rem', borderRadius: '10px', border: '1px solid rgba(var(--crest-rgb,139,227,198),0.45)', background: 'rgba(var(--crest-rgb,139,227,198),0.10)' }} data-filed="true">
                    <p style={{ ...VALUE, fontWeight: 600, fontSize: '1.125rem', color: 'var(--crest,#8be3c6)' }}>Filed. This is your agent.</p>
                    <p style={{ ...VALUE, marginTop: '0.35rem' }}>
                      Both signatures are in the register: the agent&apos;s, naming you, and yours, naming it. Anyone can check them.
                      {done.handle !== null ? <> It answers to <span style={{ fontFamily: MONO }}>@{done.handle}</span>.</> : null}
                    </p>
                    <a href={done.recordHref} style={{ ...BUTTON, marginTop: '0.85rem', textDecoration: 'none' }} data-record-link="true">See its record</a>
                  </div>
                ) : (
                  <>
                    {done !== undefined && !done.ok ? <p style={{ ...VALUE, marginTop: '0.75rem' }} data-refused="true">Not filed: {done.why}</p> : null}
                    <button
                      type="button"
                      style={{ ...BUTTON, marginTop: '1rem', opacity: left === 0 || busy !== null ? 0.5 : 1 }}
                      disabled={left === 0 || busy !== null}
                      onClick={() => void sign(request)}
                    >
                      {busy === request.address ? 'Waiting for the wallet…' : 'I operate this agent — sign and file'}
                    </button>
                  </>
                )}
              </div>
            );
          })
        : null}
      {loaded.state === 'ready' && loaded.truncated ? <p style={{ ...VALUE, color: 'var(--dim,#a3bcb8)' }}>More requests exist than this page shows; sign these first.</p> : null}

      {seekingList}
    </div>
  );
}
