'use client';
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { useCallback, useEffect, useState } from 'react';
import { MultisigSubmit } from '@/components/MultisigSubmit';

interface VaultRow {
  vaultId: string;
  coinType: string;
  decimals: number | null;
  uncollected: string;
  grossVolume: string;
}

interface CurrencyRow {
  coinType: string;
  decimals: number | null;
  uncollected: string;
  vaults: number;
}

interface Revenue {
  vaults: VaultRow[];
  byCurrency: CurrencyRow[];
  truncated: boolean;
}

interface Quote {
  bytes: string;
  gasMist: string;
  summary: string;
}

type Load =
  | { name: 'loading' }
  | { name: 'read'; revenue: Revenue }
  | { name: 'unmeasured'; detail: string };

const symbolOf = (coinType: string): string => coinType.split('::').pop() ?? coinType;

function amount(raw: string, decimals: number | null): string {
  if (decimals === null) return `${raw} (unknown scale)`;
  const value = BigInt(raw);
  if (decimals === 0) return value.toString();
  const scale = 10n ** BigInt(decimals);
  const whole = value / scale;
  const frac = (value % scale).toString().padStart(decimals, '0').replace(/0+$/, '');
  return frac === '' ? whole.toString() : `${whole}.${frac}`;
}

export function PlatformRevenue({ address }: { address: string | null }) {
  const [load, setLoad] = useState<Load>({ name: 'loading' });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [quote, setQuote] = useState<{ vaultId: string; quote: Quote } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch('/api/admin/revenue');
        const body = (await response.json()) as Revenue & { error?: string };
        if (cancelled) return;
        if (body.vaults === undefined) {
          setLoad({ name: 'unmeasured', detail: body.error ?? 'the chain did not answer' });
          return;
        }
        setLoad({ name: 'read', revenue: body });
      } catch (cause) {
        if (!cancelled) {
          setLoad({
            name: 'unmeasured',
            detail: cause instanceof Error ? cause.message : String(cause),
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const prepare = useCallback(
    async (row: VaultRow) => {
      if (address === null) return;
      setBusy(row.vaultId);
      setError(null);
      setQuote(null);
      try {
        const response = await fetch('/api/admin/prepare', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            sender: address,
            action: {
              kind: 'claim-platform-fees',
              vaultId: row.vaultId,
              coinType: row.coinType,
              amount: row.uncollected,
            },
          }),
        });
        const body = (await response.json()) as { quote?: Quote; error?: string };
        if (body.quote === undefined) {
          setError(body.error ?? 'the transaction could not be prepared');
        } else {
          setQuote({ vaultId: row.vaultId, quote: body.quote });
        }
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setBusy(null);
      }
    },
    [address],
  );

  if (load.name === 'loading') {
    return (
      <div className="card" role="status" style={{ marginTop: 'var(--space-20)' }}>
        <span className="k">REVENUE</span>
        <p style={{ color: 'var(--text-tertiary)' }}>Reading every vault…</p>
      </div>
    );
  }

  if (load.name === 'unmeasured') {
    return (
      <div className="note crit" role="alert" style={{ marginTop: 'var(--space-20)' }}>
        <span className="lbl">Reading from the chain</span>
        <p>Commission is being read from the chain. The figure appears once it answers — never an estimate.</p>
        <p className="mono" style={{ overflowWrap: 'anywhere' }}>{load.detail}</p>
      </div>
    );
  }

  const { revenue } = load;
  const owing = revenue.vaults.filter((v) => BigInt(v.uncollected) > 0n);

  return (
    <div className="card" style={{ marginTop: 'var(--space-20)' }}>
      <span className="k">UNCOLLECTED COMMISSION</span>

      {revenue.truncated && (
        <div className="note crit" role="alert" style={{ marginTop: 'var(--space-12)' }}>
          <span className="lbl">Partial</span>
          <p>
            The vault walk hit its page ceiling, so newer vaults are missing from these totals. The
            figures below are a floor, not the amount.
          </p>
        </div>
      )}

      <div className="tiers" style={{ marginTop: 'var(--space-12)' }}>
        {revenue.byCurrency.length === 0 ? (
          <p style={{ color: 'var(--text-tertiary)', margin: 0 }}>
            No vaults have charged a fee yet.
          </p>
        ) : (
          revenue.byCurrency.map((currency) => (
            <div className="stat" key={currency.coinType}>
              <span className="k">{symbolOf(currency.coinType)}</span>
              <span className="v">{amount(currency.uncollected, currency.decimals)}</span>
              <span className="k">
                {currency.vaults} vault{currency.vaults === 1 ? '' : 's'}
              </span>
            </div>
          ))
        )}
      </div>

      <p className="locked-why">
        Commission sits in the vault that charged it, in that vault&rsquo;s coin, as its own
        balance alongside the creator&rsquo;s earnings. Each vault settles on its own transaction,
        so every collection is one line on chain that anyone can read.
      </p>

      {owing.length > 0 && (
        <div style={{ marginTop: 'var(--space-16)' }}>
          {owing.map((row) => (
            <div
              key={row.vaultId}
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 'var(--space-8)',
                alignItems: 'center',
                justifyContent: 'space-between',
                paddingBlock: 'var(--space-8)',
              }}
            >
              <span className="mono" style={{ overflowWrap: 'anywhere' }}>
                {row.vaultId}
              </span>
              <span>
                <strong>
                  {amount(row.uncollected, row.decimals)} {symbolOf(row.coinType)}
                </strong>
              </span>
              {address !== null && (
                <button
                  className="btn ghost"
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void prepare(row)}
                >
                  {busy === row.vaultId ? 'Simulating…' : 'Prepare collection'}
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {error !== null && <p className="unmeasured">{error}</p>}

      {quote !== null && (
        <div className="note" style={{ marginTop: 'var(--space-16)' }}>
          <span className="lbl">Simulated — nothing signed</span>
          <p>{quote.quote.summary}</p>
          <p style={{ color: 'var(--text-tertiary)' }}>Gas: {quote.quote.gasMist} mist.</p>
          <MultisigSubmit bytes={quote.quote.bytes} summary={quote.quote.summary} />
        </div>
      )}
    </div>
  );
}
