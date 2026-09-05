'use client';
// Built-by: @projectx.sui · Co-authored-by: Claude

import { useState } from 'react';
import { formatUnits } from '@/lib/units';
import { useSigner } from '@/components/SignerProvider';
import { SignIn } from '@/components/SignIn';

interface Payment {
  checkpoint: string;
  what: string;
  gross: string;
  creatorNet: string;
  payer: string;
  digest: string;
  /** The vault coin's decimals. `null` when unread — never defaulted to six. */
  decimals: number | null;
  symbol: string;
}
type Activity =
  | { kind: 'comment'; at: number; postId: string; author: string; text: string }
  | { kind: 'follow'; at: number; follower: string; handle: string }
  | { kind: 'message'; at: number; from: string; preview: string; encrypted: boolean };

function short(a: string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}
/*
  A payment at the scale of the coin it was actually made in.

  This divided by 1e6 for every payment, so a creator paid in a nine-decimal coin read their own
  earnings a thousand times too high. `decimals` is `null` when the coin's metadata could not be
  read, and an unknown scale is shown as such rather than as a confident wrong number.
*/
function money(minor: string, decimals: number | null, symbol: string): string {
  if (decimals === null) return 'scale unknown';
  return `${formatUnits(BigInt(minor), decimals)}${symbol === '' ? '' : ` ${symbol}`}`;
}
function when(ms: number): string {
  return new Date(ms).toLocaleString();
}

export function Notifications() {
  const { signer } = useSigner();
  const [payments, setPayments] = useState<Payment[] | null>(null);
  const [activity, setActivity] = useState<Activity[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);


  async function load() {
    if (signer === null) return;
    setBusy(true);
    setError(null);
    try {
      const timestampMs = Date.now();
      const signature = await signer.signPersonalMessage(new TextEncoder().encode(
          `Weir\naddress: ${signer.address}\nissued: ${timestampMs}\norigin: ${window.location.origin}` +
            `\naction: read\nthread with: ${signer.address}`,
        ));

      const r = await fetch('/api/notifications', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ viewer: signer.address, signature, timestampMs }),
      });
      const b = (await r.json()) as {
        payments?: Payment[];
        activity?: Activity[];
        truncated?: boolean;
        error?: string;
      };
      if (b.payments === undefined) {
        // A failure, not an empty inbox. Those look identical and only one means nothing happened.
        setError(b.error ?? 'could not read alerts');
      } else {
        setPayments(b.payments);
        setActivity(b.activity ?? []);
        setTruncated(b.truncated === true);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (signer === null) {
    return (
      <div className="panel">
        <p style={{ marginTop: 0 }}>
          Your alerts are a personal inbox, so reading them is signed.
        </p>
        <SignIn />
        {error !== null && <p className="unmeasured">{error}</p>}
      </div>
    );
  }

  return (
    <>
      <button className="btn" type="button" disabled={busy} onClick={() => void load()}>
        {busy ? 'Signing…' : payments === null ? 'Load alerts' : 'Refresh'}
      </button>
      {error !== null && (
        <div className="note crit" style={{ marginTop: 16 }}>
          <span className="lbl">Not measured</span>
          <p className="mono" style={{ fontSize: 13 }}>{error}</p>
        </div>
      )}

      {payments !== null && (
        <>
          <h2>Payments</h2>
          <p className="section-note">
            From PaymentSettled on chain · ordered by checkpoint, which is exact
          </p>
          {payments.length === 0 ? (
            <div className="panel empty">
              No payments. The event log was read and holds none for your vaults.
            </div>
          ) : (
            <div className="scroll">
              <table>
                <thead>
                  <tr>
                    <th>What</th>
                    <th>From</th>
                    <th className="num">You received</th>
                    <th className="num">Gross</th>
                    <th>Checkpoint</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((p) => (
                    <tr key={p.digest + p.checkpoint}>
                      <td>{p.what}</td>
                      <td className="mono">{short(p.payer)}</td>
                      <td className="num">{money(p.creatorNet, p.decimals, p.symbol)}</td>
                      <td className="num">{money(p.gross, p.decimals, p.symbol)}</td>
                      <td>
                        <a
                          className="mono"
                          href={`https://suiscan.xyz/mainnet/tx/${p.digest}`}
                          rel="noreferrer"
                          target="_blank"
                        >
                          {p.checkpoint}
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {truncated && (
            <div className="note warn">
              <span className="lbl">Recent, not complete</span>
              <p>The page ceiling was reached — older payments are not shown.</p>
            </div>
          )}

          <h2>Activity</h2>
          <p className="section-note">Comments, follows and messages · wall clock</p>
          {activity?.length === 0 ? (
            <div className="panel empty">Nothing yet.</div>
          ) : (
            <div className="panel">
              {activity?.map((a, i) => (
                <div key={i} className="comment">
                  <span className="mono comment-author">
                    {when(a.at)}
                  </span>
                  <span>
                    {a.kind === 'comment' && (
                      <>
                        <strong>{short(a.author)}</strong> commented: {a.text.slice(0, 80)}
                      </>
                    )}
                    {a.kind === 'follow' && (
                      <>
                        <strong>{short(a.follower)}</strong> followed @{a.handle}
                      </>
                    )}
                    {a.kind === 'message' && (
                      <>
                        <strong>{short(a.from)}</strong> messaged you
                        {a.encrypted ? (
                          // No comma after the badge — it carries a right margin, and a comma
                          // pushed off the word it follows reads as a typo.
                          <> — <span className="enc-tag">encrypted</span> open the thread to read it</>
                        ) : (
                          <>: {a.preview.slice(0, 60)}</>
                        )}
                      </>
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </>
  );
}
