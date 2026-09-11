'use client';
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { accessStatement } from '@projectx-social/sdk';
import { useEffect, useState } from 'react';
import { formatUnits } from '@/lib/units';
import { NO_MACHINE_BODY, machineContentKey, machineKeyProblem } from '@/lib/machine-pricing';
import { retentionDays } from '@/lib/storage-retention';
import { useSigner } from '@/components/SignerProvider';
import { SignIn } from '@/components/SignIn';

interface Target { vaultId: string; coinType: string; handle: string; tiers: { index: number; name: string; active: boolean }[]; decimals: number; symbol: string }

type Access = 'public' | 'subscribers' | 'paid';

type TargetState = 'idle' | 'loading' | 'none' | 'failed' | 'ready';

type Stage =
  | { name: 'idle' }
  | { name: 'pricing' }
  | { name: 'priced'; digest: string }
  | { name: 'publishing' }
  | { name: 'published'; id: string }
  | { name: 'failed'; message: string };

type MediaState =
  | { name: 'none' }
  | { name: 'storing' }
  /** `endEpoch` is when the storage lease runs out, not a decoration. */
  | { name: 'stored'; blobId: string; endEpoch: number }
  | { name: 'failed'; message: string };

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function sha256HexBytes(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as unknown as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const ACCEPTED_IMAGES = 'image/png,image/jpeg,image/gif,image/webp';

function toMinor(input: string, decimals: number): bigint | null {
  const t = input.trim();
  if (!new RegExp(`^\\d+(\\.\\d{1,${decimals}})?$`).test(t)) return null;
  const [whole, frac = ''] = t.split('.');
  return BigInt(whole + frac.padEnd(decimals, '0'));
}

interface CreatorBody {
  stage?: 'no-account' | 'no-vault' | 'ready';
  vaults?: { vaultId: string; coinType: string; handle: string | null; tiers?: { index: number; name: string; active: boolean }[]; decimals?: number; symbol?: string }[];
}

export function StudioComposer() {
  const { signer } = useSigner();
  const [targets, setTargets] = useState<Target[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [targetState, setTargetState] = useState<TargetState>('idle');
  const [title, setTitle] = useState('');
  const [preview, setPreview] = useState('');
  const [text, setText] = useState('');
  const [access, setAccess] = useState<Access>('public');
  const [tier, setTier] = useState(0);
  const [contentKey, setContentKey] = useState('');
  const [price, setPrice] = useState('0.10');
  const [stage, setStage] = useState<Stage>({ name: 'idle' });
  const [image, setImage] = useState<File | null>(null);
  const [media, setMedia] = useState<MediaState>({ name: 'none' });
  const [keyPrice, setKeyPrice] = useState<
    { name: 'unknown' } | { name: 'checking' } | { name: 'known'; price: bigint | null } | { name: 'unreadable' }
  >({ name: 'unknown' });
  const [machineKeyPrice, setMachineKeyPrice] = useState<
    { name: 'unknown' } | { name: 'checking' } | { name: 'known'; price: bigint | null } | { name: 'unreadable' }
  >({ name: 'unknown' });
  const [machinePrice, setMachinePrice] = useState('');
  const [machineBody, setMachineBody] = useState<'unknown' | 'no-post' | 'sealed' | 'absent'>('unknown');
  const [machineStage, setMachineStage] = useState<Stage>({ name: 'idle' });

  useEffect(() => {
    const address = signer?.address;
    if (address === undefined) {
      setTargets([]);
      setSelected(null);
      setTargetState('idle');
      return;
    }

    let cancelled = false;
    setTargetState('loading');

    void fetch(`/api/creator?owner=${encodeURIComponent(address)}`)
      .then(async (response) => {
        if (!response.ok) throw new Error(`the chain returned ${response.status}`);
        return (await response.json()) as CreatorBody;
      })
      .then((body) => {
        if (cancelled) return;
        const publishable = (body.vaults ?? []).flatMap((vault) =>
          vault.handle === null
            ? []
            : [{ vaultId: vault.vaultId, coinType: vault.coinType, handle: vault.handle, tiers: vault.tiers ?? [], decimals: vault.decimals ?? 6, symbol: vault.symbol ?? vault.coinType.split('::').pop() ?? '' }],
        );
        setTargets(publishable);
        setSelected(publishable[0]?.vaultId ?? null);
        setTargetState(publishable.length === 0 ? 'none' : 'ready');
      })
      .catch(() => {
        if (cancelled) return;
        setTargets([]);
        setSelected(null);
        setTargetState('failed');
      });

    return () => { cancelled = true; };
  }, [signer]);

  const target = targets.find((t) => t.vaultId === selected) ?? null;

  async function signAndSubmit(bytes: string): Promise<string> {
    if (signer === null) throw new Error('not signed in');
    const signature = await signer.signTransaction(bytes);
    const response = await fetch('/api/checkout/submit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ bytes, signature }),
    });
    const body = (await response.json()) as { digest?: string; error?: string };
    if (body.digest === undefined) throw new Error(body.error ?? 'submission failed');
    return body.digest;
  }

  useEffect(() => {
    const key = contentKey.trim();
    if (access !== 'paid' || target === null || key === '' || machineKeyProblem(key) !== null) {
      setKeyPrice({ name: 'unknown' });
      setMachineKeyPrice({ name: 'unknown' });
      setMachineBody('unknown');
      return;
    }

    setKeyPrice({ name: 'checking' });
    setMachineKeyPrice({ name: 'checking' });
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const response = await fetch(
            `/api/studio/content-price?vaultId=${encodeURIComponent(target.vaultId)}` +
              `&contentKey=${encodeURIComponent(key)}`,
            { signal: controller.signal },
          );
          if (!response.ok) {
            setKeyPrice({ name: 'unreadable' });
            setMachineKeyPrice({ name: 'unreadable' });
            return;
          }
          const body = (await response.json()) as {
            price?: string | null;
            machine?: { state?: string; price?: string | null };
            machineBody?: string;
          };
          setMachineBody(
            body.machineBody === 'sealed' || body.machineBody === 'no-post' || body.machineBody === 'absent'
              ? body.machineBody
              : 'unknown',
          );
          setKeyPrice({
            name: 'known',
            price: body.price == null ? null : BigInt(body.price),
          });
          setMachineKeyPrice(
            body.machine?.state === 'priced' && body.machine.price != null
              ? { name: 'known', price: BigInt(body.machine.price) }
              : body.machine?.state === 'unpriced'
                ? { name: 'known', price: null }
                : { name: 'unreadable' },
          );
        } catch (error) {
          if (!(error instanceof Error) || error.name !== 'AbortError') {
            setKeyPrice({ name: 'unreadable' });
            setMachineKeyPrice({ name: 'unreadable' });
          }
        }
      })();
    }, 400);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [access, contentKey, target]);

  async function priceKeyOnChain(input: {
    key: string;
    amount: string;
    report: (stage: Stage) => void;
  }) {
    const { key, amount, report } = input;
    if (signer === null || target === null) return;
    const minor = toMinor(amount, target.decimals);
    if (minor === null) {
      report({ name: 'failed', message: `Price must be a decimal with up to ${target.decimals} places.` });
      return;
    }
    if (key === '') {
      report({ name: 'failed', message: 'A paid post needs a content key.' });
      return;
    }

    report({ name: 'pricing' });
    try {
      const response = await fetch('/api/studio/price', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sender: signer.address,
          vaultId: target.vaultId,
          coinType: target.coinType,
          contentKey: key,
          price: minor.toString(),
        }),
      });
      const body = (await response.json()) as {
        quote?: { bytes: string };
        blocked?: string;
        error?: string;
      };
      if (body.blocked === 'no-creator-cap') {
        report({
          name: 'failed',
          message: 'This wallet does not hold a CreatorCap, so it cannot price content.',
        });
        return;
      }
      if (body.quote === undefined) {
        report({ name: 'failed', message: body.error ?? 'pricing simulation failed' });
        return;
      }
      report({ name: 'priced', digest: await signAndSubmit(body.quote.bytes) });
    } catch (error) {
      report({ name: 'failed', message: error instanceof Error ? error.message : String(error) });
    }
  }

  async function attachMedia(postId: string, file: File) {
    if (signer === null) return;
    setMedia({ name: 'storing' });
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const fileSha256 = await sha256HexBytes(bytes);
      const timestampMs = Date.now();
      const statement =
        `Weir\naddress: ${signer.address}\nissued: ${timestampMs}\norigin: ${window.location.origin}` +
        `\naction: upload\npost: ${postId}\nfile-sha256: ${fileSha256}`;
      const signature = await signer.signPersonalMessage(new TextEncoder().encode(statement));

      const form = new FormData();
      form.set('postId', postId);
      form.set('author', signer.address);
      form.set('file', file);
      form.set('signature', signature);
      form.set('timestampMs', String(timestampMs));

      const response = await fetch('/api/studio/upload', { method: 'POST', body: form });
      const body = (await response.json()) as {
        assetId?: string;
        blobId?: string;
        endEpoch?: number;
        error?: string;
      };

      if (body.assetId === undefined || body.blobId === undefined || body.endEpoch === undefined) {
        setMedia({ name: 'failed', message: body.error ?? 'the image could not be stored' });
        return;
      }
      setMedia({ name: 'stored', blobId: body.blobId, endEpoch: body.endEpoch });
    } catch (error) {
      setMedia({
        name: 'failed',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async function publish() {
    if (target === null) return;
    if (signer === null) return;
    setStage({ name: 'publishing' });
    try {
      const timestampMs = Date.now();
      const contentSha256 = await sha256Hex(`${preview.length}:${preview}${text.length}:${text}`);
      const signedKey = access === 'paid' ? contentKey.trim() : '';
      const signedPrice = access === 'paid' ? (effectivePrice?.toString() ?? '') : '';
      const statement =
        `Weir\naddress: ${signer.address}\nissued: ${timestampMs}\norigin: ${window.location.origin}` +
        `\naction: publish\ncreator: ${target.handle}\naccess: ${accessStatement(access, access === 'subscribers' ? tier : 0)}\ntitle: ${title}\ncontent-sha256: ${contentSha256}\nkey: ${signedKey}\nprice: ${signedPrice}`;
      const signature = await signer.signPersonalMessage(new TextEncoder().encode(statement));

      const response = await fetch('/api/posts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          handle: target.handle,
          author: signer.address,
          title,
          preview,
          text,
          access,
          ...(access === 'subscribers' && tier > 0 ? { tier } : {}),
          signature,
          timestampMs,
          ...(access === 'paid'
            ? { contentKey: signedKey, price: signedPrice }
            : {}),
        }),
      });
      const body = (await response.json()) as { post?: { id: string }; error?: string };
      if (body.post === undefined) {
        setStage({ name: 'failed', message: body.error ?? 'publish failed' });
        return;
      }
      setStage({ name: 'published', id: body.post.id });

      if (image !== null) await attachMedia(body.post.id, image);

      setTitle('');
      setPreview('');
      setText('');
      setContentKey('');
      setMachinePrice('');
      setMachineStage({ name: 'idle' });
      setImage(null);
    } catch (error) {
      setStage({ name: 'failed', message: error instanceof Error ? error.message : String(error) });
    }
  }

  const blockers = [
    title.trim() === '' ? 'a title' : null,
    preview.trim() === '' ? 'a preview' : null,
    text.trim() === '' ? 'a body' : null,
  ].filter((reason): reason is string => reason !== null);

  const onChainPrice = keyPrice.name === 'known' ? keyPrice.price : null;
  const effectivePrice =
    target === null
      ? null
      : stage.name === 'priced'
        ? toMinor(price, target.decimals)
        : (onChainPrice ?? toMinor(price, target.decimals));

  const needsPricing = access === 'paid' && stage.name !== 'priced' && onChainPrice === null;

  const reservedKey = access === 'paid' && contentKey.trim() !== ''
    ? machineKeyProblem(contentKey)
    : null;
  const derivedMachineKey = (() => {
    const derived = machineContentKey(contentKey);
    return derived.ok ? derived.value : null;
  })();
  const machineOnChainPrice = machineKeyPrice.name === 'known' ? machineKeyPrice.price : null;
  const canPublish =
    blockers.length === 0 && !needsPricing && signer !== null && target !== null;

  if (signer === null) {
    return (
      <div className="panel">
        <p style={{ marginTop: 0, color: 'var(--text-secondary)' }}>
          Posts are filed under a creator page, and the publish route reads that page&rsquo;s owner
          from chain before it accepts anything. The composer opens once a wallet is connected.
        </p>
        <SignIn />
      </div>
    );
  }

  if (targetState === 'idle' || targetState === 'loading') {
    return (
      <div className="panel">
        <p style={{ margin: 0, color: 'var(--text-tertiary)' }}>Reading your vaults…</p>
      </div>
    );
  }

  if (targetState === 'failed') {
    return (
      <div className="note crit">
        <span className="lbl">Reading from the chain</span>
        <p>
          Your vaults are loading. The composer opens as soon as one answers, so a post is never
          aimed at a vault this page has not confirmed.
        </p>
      </div>
    );
  }

  if (target === null) {
    return (
      <div className="note warn">
        <span className="lbl">No named vault</span>
        <p>
          Posts hang off a creator page, and this address has none yet: either no vault, or a vault
          that has not been named. <a href="/creator">Set one up</a>.
        </p>
      </div>
    );
  }

  return (
    <>
      {targets.length > 1 ? (
        <div className="panel" style={{ marginBottom: 'var(--space-16)' }}>
          <label className="k" htmlFor="v">PUBLISH TO</label>
          <select
            id="v"
            className="field"
            value={target.vaultId}
            onChange={(e) => {
              setSelected(e.target.value);
              setStage({ name: 'idle' });
            }}
          >
            {targets.map((t) => (
              <option key={t.vaultId} value={t.vaultId}>
                @{t.handle} · {t.vaultId.slice(0, 14)}…
              </option>
            ))}
          </select>
        </div>
      ) : (
        <p className="section-note">
          Publishing as <strong>@{target.handle}</strong> into{' '}
          <span className="mono">{target.vaultId.slice(0, 14)}…</span>
        </p>
      )}

      <div className="panel" style={{ display: 'grid', gap: 14, marginTop: 24 }}>
        <div>
          <label className="k" htmlFor="t">TITLE</label>
          <input id="t" className="field" value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div>
          <label className="k" htmlFor="p">PREVIEW · always visible, even when locked</label>
          <input id="p" className="field" value={preview} onChange={(e) => setPreview(e.target.value)} />
        </div>
        <div>
          <label className="k" htmlFor="b">BODY · shown only to readers who hold access</label>
          <textarea id="b" rows={8} className="field" value={text} onChange={(e) => setText(e.target.value)} />
        </div>

        <div>
          <label className="k" htmlFor="img">IMAGE · optional, stored on Walrus</label>
          <input
            id="img"
            type="file"
            className="field"
            accept={ACCEPTED_IMAGES}
            onChange={(e) => {
              setImage(e.target.files?.[0] ?? null);
              setMedia({ name: 'none' });
            }}
          />
          {image !== null && (
            <p className="enc-status" style={{ marginTop: 6 }}>
              {access === 'paid' ? (
                <>
                  <span className="enc-tag">encrypted</span> stored encrypted. Unreadable
                  without an unlock or subscription, even to somebody holding the file. Kept for{' '}
                  <strong>{retentionDays('durable')} days</strong>, about two years.
                </>
              ) : (
                <>
                  <span className="enc-tag off">
                    {access === 'public' ? 'public' : 'subscribers'}
                  </span>{' '}
                  {access === 'public'
                    ? 'readable by anyone from any Walrus aggregator, without this platform. '
                    : 'stored unencrypted, so the words are gated but the image is not. '}
                  Kept for <strong>{retentionDays('ephemeral')} days</strong>, then{' '}
                  <strong>deleted</strong>. The post stays; the picture goes.
                </>
              )}
            </p>
          )}

          {media.name === 'storing' && <p className="unmeasured">Storing the image on Walrus…</p>}
          {media.name === 'stored' && (
            <div className="note" style={{ marginTop: 'var(--space-12)' }}>
              <span className="lbl">Image stored</span>
              <p>
                <span className="mono">{media.blobId.slice(0, 14)}…</span> The lease runs to Walrus
                epoch {media.endEpoch}. Unless it is extended before then, the image is deleted and
                this post keeps its words without its picture.
              </p>
            </div>
          )}
          {media.name === 'failed' && (
            <p className="unmeasured">
              The post published, but the image did not store: {media.message}
            </p>
          )}
        </div>

        <div>
          <label className="k" htmlFor="a">ACCESS</label>
          <select
            id="a"
            className="field"
            value={access}
            onChange={(e) => {
              setAccess(e.target.value as Access);
              setStage({ name: 'idle' });
            }}
          >
            <option value="public">Public: anyone</option>
            <option value="subscribers">Subscribers only</option>
            <option value="paid">Paid: bought once</option>
          </select>
        </div>

        {access === 'subscribers' && target !== null && target.tiers.filter((t) => t.active).length > 1 && (
          <div>
            <label className="k" htmlFor="tier">TIER · the lowest tier that can open this post</label>
            <select
              id="tier"
              className="field"
              value={tier}
              onChange={(e) => {
                setTier(Number(e.target.value));
                setStage({ name: 'idle' });
              }}
            >
              {target.tiers
                .filter((t) => t.active)
                .map((t) => (
                  <option key={t.index} value={t.index}>
                    {t.index === 0 ? `${t.name}: every subscriber` : `${t.name} and above`}
                  </option>
                ))}
            </select>
          </div>
        )}

        {access === 'paid' && (
          <div style={{ display: 'grid', gap: 12, gridTemplateColumns: '2fr 1fr' }}>
            <div>
              <label className="k" htmlFor="k">CONTENT KEY · the name of what a reader buys, on chain</label>
              <input id="k" className="field" value={contentKey} onChange={(e) => setContentKey(e.target.value)} />
              {keyPrice.name === 'checking' && (
                <p className="unmeasured" style={{ marginTop: 6 }}>Reading the vault…</p>
              )}
              {keyPrice.name === 'unreadable' && (
                <p className="unmeasured" style={{ marginTop: 6 }}>
                  This key&rsquo;s price is being read from the chain, so whether anyone already holds it is
                  unknown. Not the same as it being free.
                </p>
              )}
              {keyPrice.name === 'known' && keyPrice.price !== null && (
                <p className="enc-status" style={{ marginTop: 6 }}>
                  <span className="enc-tag">in use</span> already sells at{' '}
                  {formatUnits(keyPrice.price, target.decimals)} {target.symbol}. Everyone who bought it reads this
                  post too, at no extra charge
                </p>
              )}
              {keyPrice.name === 'known' && keyPrice.price === null && contentKey.trim() !== '' && (
                <p className="enc-status" style={{ marginTop: 6 }}>
                  <span className="enc-tag off">new</span> nothing is sold under this key yet, so
                  this post starts it
                </p>
              )}
            </div>
            <div>
              <label className="k" htmlFor="pr">PRICE · {target?.symbol ?? ''}</label>
              <input id="pr" className="field" value={price} onChange={(e) => setPrice(e.target.value)} />
            </div>
          </div>
        )}

        {access === 'paid' && reservedKey !== null && (
          <div className="note warn">
            <span className="lbl">Reserved key</span>
            <p>{reservedKey}</p>
          </div>
        )}

        {access === 'paid' && reservedKey === null && derivedMachineKey !== null && (
          <div className="note">
            <span className="lbl">Machine edition (optional)</span>
            <p>
              The same words, sold to agents under a second key on the same vault. It is a separate
              price, a separate purchase and a separate key: a machine buyer&rsquo;s Unlock does not
              open the human edition and a reader&rsquo;s does not open this one. Leave the price
              empty to offer no machine edition.
            </p>
            <p className="mono" style={{ fontSize: 13 }}>{derivedMachineKey}</p>
            {machineKeyPrice.name === 'checking' && (
              <p className="unmeasured">Reading the vault…</p>
            )}
            {machineKeyPrice.name === 'unreadable' && (
              <p className="unmeasured">
                This edition&rsquo;s price is being read from the chain, so whether it is already on sale is
                unknown. Not the same as it being unpriced.
              </p>
            )}
            {machineKeyPrice.name === 'known' && machineOnChainPrice !== null && (
              <p className="enc-status">
                <span className="enc-tag">on sale</span> machines already pay{' '}
                {formatUnits(machineOnChainPrice, target.decimals)} {target.symbol} for this key. Pricing it again replaces
                that; every Unlock already sold stays valid
              </p>
            )}
            {machineKeyPrice.name === 'known' && machineOnChainPrice === null && (
              <p className="enc-status">
                <span className="enc-tag off">not offered</span> nothing is sold to machines under
                this key yet
              </p>
            )}
            {machineBody === 'absent' && (
              <p className="unmeasured">
                &ldquo;{contentKey.trim()}&rdquo; {NO_MACHINE_BODY}
              </p>
            )}
            {machineBody !== 'absent' && (
            <div style={{ display: 'grid', gap: 12, gridTemplateColumns: '1fr 1fr', marginTop: 10 }}>
              <div>
                <label className="k" htmlFor="mpr">MACHINE PRICE · {target?.symbol ?? ''}</label>
                <input
                  id="mpr"
                  className="field"
                  value={machinePrice}
                  onChange={(e) => setMachinePrice(e.target.value)}
                />
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                <button
                  className="btn ghost"
                  type="button"
                  disabled={machineStage.name === 'pricing' || machinePrice.trim() === ''}
                  onClick={() =>
                    void priceKeyOnChain({
                      key: derivedMachineKey,
                      amount: machinePrice,
                      report: setMachineStage,
                    })
                  }
                >
                  {machineStage.name === 'pricing' ? 'Pricing…' : 'Price the machine edition'}
                </button>
              </div>
            </div>
            )}
            {machineStage.name === 'priced' && (
              <p className="mono" style={{ fontSize: 13 }}>{machineStage.digest}</p>
            )}
            {machineStage.name === 'failed' && (
              <p className="unmeasured">{machineStage.message}</p>
            )}
          </div>
        )}

        {needsPricing && (
          <div className="note warn">
            <span className="lbl">Price it on chain first</span>
            <p>
              A paid post cannot be sold until its key has a price on the vault. The contract reads
              the price itself and refuses content that has none. Publishing before that would put a
              buy button on the feed that fails every time.
            </p>
          </div>
        )}

        {stage.name === 'priced' && (
          <div className="note">
            <span className="lbl">Priced on chain</span>
            <p className="mono" style={{ fontSize: 13 }}>{stage.digest}</p>
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {access === 'paid' && stage.name !== 'priced' && (
            <button
              className="btn ghost"
              type="button"
              disabled={stage.name === 'pricing'}
              onClick={() =>
                void priceKeyOnChain({
                  key: contentKey.trim(),
                  amount: price,
                  report: setStage,
                })
              }
            >
              {stage.name === 'pricing' ? 'Pricing…' : 'Price on chain'}
            </button>
          )}
          <button
            className="btn"
            type="button"
            disabled={!canPublish || stage.name === 'publishing'}
            onClick={() => void publish()}
          >
            {stage.name === 'publishing' ? 'Publishing…' : 'Publish'}
          </button>
        </div>

        {blockers.length > 0 && (
          <p className="section-note" style={{ margin: 0 }}>
            Waiting on{' '}
            {blockers.length > 1
              ? `${blockers.slice(0, -1).join(', ')} and ${blockers[blockers.length - 1]}`
              : blockers[0]}
            .
          </p>
        )}

        {stage.name === 'published' && (
          <div className="note">
            <span className="lbl">Published</span>
            <p>
              Post {stage.id} is live. <a href="/">Back to the feed</a>.
            </p>
          </div>
        )}
        {stage.name === 'failed' && (
          <div className="note crit">
            <span className="lbl">Nothing was published</span>
            <p className="mono" style={{ fontSize: 13 }}>{stage.message}</p>
          </div>
        )}
      </div>
    </>
  );
}
