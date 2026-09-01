'use client';
// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
/**
 * What a creator promises the people who tip them.
 *
 * The one surface here whose contents no contract enforces, so it says that in the panel rather
 * than in a footnote: the tip is on chain and permanent, the promise is the creator's word.
 *
 * The statement signed is the digest of the exact list — see `lib/perks-digest.ts`, which both this
 * and the route import so there is one definition of "canonical" rather than two that can drift.
 */
import { useEffect, useState } from 'react';
import { useSigner } from '@/components/SignerProvider';
import { perksDigest, type DigestPerk } from '@/lib/perks-digest';
import { MAX_DETAIL, MAX_PERKS, MAX_TITLE } from '@/lib/perks-limits';

/** Must match `statementFor` in lib/identity.ts exactly. */
function statement(
  handle: string,
  perksSha256: string,
  supportersFirst: boolean,
  address: string,
  timestampMs: number,
): string {
  /*
    The action in one template literal, deliberately.

    `test/statement-drift.test.ts` compares this against `statementFor` by reading the source, and
    it can only see one literal at a time — a statement split across concatenated strings is
    matched in fragments and the tail goes unpinned. That is the half most likely to drift.
  */
  const yesNo = supportersFirst ? 'yes' : 'no';
  return (
    `Weir\naddress: ${address}\nissued: ${timestampMs}\norigin: ${window.location.origin}` +
    `\naction: set perks\nhandle: ${handle}\nperks-sha256: ${perksSha256}\nsupporters-first: ${yesNo}`
  );
}

interface Draft {
  amount: string;
  title: string;
  detail: string;
}

/**
 * A decimal the creator types, as the smallest unit.
 *
 * By string, never `parseFloat(x) * 10 ** decimals`, which is wrong in the last unit for most
 * inputs — and the last unit is exactly where a threshold decides whether somebody qualifies.
 * Returns null for anything that is not a plain non-negative decimal.
 */
export function toUnits(amount: string, decimals: number): string | null {
  const text = amount.trim();
  if (!/^\d*(\.\d*)?$/.test(text) || text === '' || text === '.') return null;
  const [whole = '', fraction = ''] = text.split('.');
  if (fraction.length > decimals) return null;
  const padded = (fraction + '0'.repeat(decimals)).slice(0, decimals);
  const units = `${whole}${padded}`.replace(/^0+(?=\d)/, '');
  return units === '' ? '0' : units;
}

/** The smallest unit back to a decimal, for showing what is already stored. */
export function fromUnits(units: string, decimals: number): string {
  const padded = units.padStart(decimals + 1, '0');
  const whole = padded.slice(0, padded.length - decimals);
  const fraction = decimals === 0 ? '' : padded.slice(padded.length - decimals).replace(/0+$/, '');
  return fraction === '' ? whole : `${whole}.${fraction}`;
}

export function PerksEditor({
  handle,
  symbol,
  decimals,
}: {
  handle: string;
  /** The creator's own vault coin — thresholds are in it, because settlements are. */
  symbol: string;
  decimals: number;
}) {
  const { signer } = useSigner();
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [supportersFirst, setSupportersFirst] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(`/api/creator/perks?handle=${encodeURIComponent(handle)}`);
        if (!response.ok) return;
        const body = (await response.json()) as {
          perks?: { thresholdUnits: string; title: string; detail: string }[];
          supportersFirst?: boolean;
        };
        if (cancelled) return;
        setDrafts(
          (body.perks ?? []).map((p) => ({
            amount: fromUnits(p.thresholdUnits, decimals),
            title: p.title,
            detail: p.detail,
          })),
        );
        setSupportersFirst(body.supportersFirst === true);
      } catch {
        // Left empty, and `loaded` still flips: an unreachable store must not look like a creator
        // who has set nothing, so the panel says so below rather than showing a confident blank.
        if (!cancelled) setError('Your saved perks could not be read just now.');
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [handle, decimals]);

  function update(index: number, patch: Partial<Draft>) {
    setSaved(false);
    setDrafts((was) => was.map((d, i) => (i === index ? { ...d, ...patch } : d)));
  }

  async function save() {
    if (signer === null) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const perks: DigestPerk[] = [];
      for (const draft of drafts) {
        const units = toUnits(draft.amount, decimals);
        if (units === null) {
          setError(`"${draft.amount || 'blank'}" is not an amount in ${symbol}.`);
          setBusy(false);
          return;
        }
        if (draft.title.trim() === '') {
          setError('Every perk needs a title.');
          setBusy(false);
          return;
        }
        perks.push({ thresholdUnits: units, title: draft.title.trim(), detail: draft.detail.trim() });
      }
      const digest = await perksDigest(perks, supportersFirst);
      const timestampMs = Date.now();
      const signature = await signer.signPersonalMessage(
        new TextEncoder().encode(
          statement(handle, digest, supportersFirst, signer.address, timestampMs),
        ),
      );
      const response = await fetch('/api/creator/perks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          address: signer.address,
          handle,
          perks,
          supportersFirst,
          signature,
          timestampMs,
        }),
      });
      const body = (await response.json()) as { perks?: number; error?: string };
      if (body.perks === undefined) setError(body.error ?? 'Could not save.');
      else setSaved(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  }

  if (signer === null) {
    return <p className="section-note">Sign in to set what supporters get.</p>;
  }

  return (
    <div className="perks-edit">
      <div className="perks-edit__rows">
        {drafts.map((draft, index) => (
          <div key={index} className="perks-edit__row">
            <label>
              <span className="lbl">Tipped at least</span>
              <span className="perks-edit__amount">
                <input
                  className="field"
                  inputMode="decimal"
                  value={draft.amount}
                  onChange={(e) => update(index, { amount: e.target.value })}
                  aria-label={`Threshold for perk ${index + 1}, in ${symbol}`}
                />
                <span className="mono">{symbol}</span>
              </span>
            </label>
            <label>
              <span className="lbl">They get</span>
              <input
                className="field"
                maxLength={MAX_TITLE}
                value={draft.title}
                placeholder="A monthly call"
                onChange={(e) => update(index, { title: e.target.value })}
                aria-label={`Perk ${index + 1} title`}
              />
            </label>
            <label>
              <span className="lbl">Detail, if it needs one</span>
              <textarea
                className="field"
                rows={2}
                maxLength={MAX_DETAIL}
                value={draft.detail}
                onChange={(e) => update(index, { detail: e.target.value })}
                aria-label={`Perk ${index + 1} detail`}
              />
            </label>
            <button
              type="button"
              className="btn ghost"
              onClick={() => {
                setSaved(false);
                setDrafts((was) => was.filter((_, i) => i !== index));
              }}
            >
              Remove
            </button>
          </div>
        ))}
      </div>

      {loaded && drafts.length === 0 && (
        <p className="section-note">
          Nothing yet. A tip already reaches you — this is where you say what, if anything, it also gets them.
        </p>
      )}

      <div className="perks-edit__actions">
        <button
          type="button"
          className="btn ghost"
          disabled={drafts.length >= MAX_PERKS}
          onClick={() => {
            setSaved(false);
            setDrafts((was) => [...was, { amount: '', title: '', detail: '' }]);
          }}
        >
          Add a perk
        </button>
        <label className="perks-edit__first">
          <input
            type="checkbox"
            checked={supportersFirst}
            onChange={(e) => {
              setSaved(false);
              setSupportersFirst(e.target.checked);
            }}
          />
          <span>Say on my page that I answer supporters first</span>
        </label>
        <button type="button" className="btn" disabled={busy} onClick={save}>
          {busy ? 'Signing…' : 'Save perks'}
        </button>
      </div>

      {error !== null && <p className="form-note warn">{error}</p>}
      {saved && <p className="form-note">Saved. They are on your page now.</p>}

      <div className="note warn perks-edit__honest">
        <span className="lbl">This part is not enforced by the contract</span>
        <p>
          A tip settles on chain and cannot be reversed — but it mints no object, so nothing here can
          hold you to what you promise. Your page says so beside these, in those words. Everything
          else on Weir is enforced by code; this is your word, and we would rather label it than let
          a reader assume otherwise.
        </p>
      </div>
    </div>
  );
}
