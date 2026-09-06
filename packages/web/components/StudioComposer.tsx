'use client';
// Built-by: @projectx.sui · Co-authored-by: Claude

/**
 * The composer half of the creator studio.
 *
 * # A paid post is priced on chain before it is published, never after
 *
 * `unlock` reads the price from the vault and refuses content that has none, so a post stored as
 * paid whose key was never priced would show a buy button that aborts every time. The composer
 * therefore refuses to publish until the pricing transaction has landed — the publish button does
 * not exist before then, in the same way the checkout's confirm button does not exist before a
 * simulation passes.
 *
 * Authorship is not asserted here either. The publish route reads the vault's owner from chain and
 * refuses anyone else, so a forged form field buys nothing.
 *
 * # The target was declared and never read
 *
 * The page this was split out of carried `target` and `targetState` and nothing ever assigned to
 * either: there was no fetch. `target` was therefore `null` for every visitor, `canPublish` was
 * false for every visitor, and the publish button could not render at all — the studio could
 * compose a post and never file one. The three status notes were unreachable for the same reason.
 * The load is now performed, and every state it can end in is shown.
 *
 * # Which vault, when there are several
 *
 * A creator may hold more than one vault, so "the" vault is not something this page can assume. The
 * published ones are offered and the choice is explicit; an unpublished vault is not offered at
 * all, because posts hang off a profile handle and a vault without one has nowhere to file them.
 */

import { accessStatement } from '@projectx-social/sdk';
import { useEffect, useState } from 'react';
import { formatUnits } from '@/lib/units';
import { NO_MACHINE_BODY, machineContentKey, machineKeyProblem } from '@/lib/machine-pricing';
import { retentionDays } from '@/lib/storage-retention';
import { useSigner } from '@/components/SignerProvider';
import { SignIn } from '@/components/SignIn';

interface Target { vaultId: string; coinType: string; handle: string; tiers: { index: number; name: string; active: boolean }[]; decimals: number; symbol: string }

type Access = 'public' | 'subscribers' | 'paid';

/** What the target load ended in. `loading` and `none` are different answers and look different. */
type TargetState = 'idle' | 'loading' | 'none' | 'failed' | 'ready';

type Stage =
  | { name: 'idle' }
  | { name: 'pricing' }
  | { name: 'priced'; digest: string }
  | { name: 'publishing' }
  | { name: 'published'; id: string }
  | { name: 'failed'; message: string };

/**
 * What happened to an attached image, kept separate from `Stage`.
 *
 * A post that published and whose image failed to store is **not** a failed post — the words are
 * live and readable. Folding the two together would either roll back a good publish or hide a lost
 * upload, and a creator needs to be told exactly which half went wrong.
 */
type MediaState =
  | { name: 'none' }
  | { name: 'storing' }
  /** `endEpoch` is when the storage lease runs out, not a decoration. */
  | { name: 'stored'; blobId: string; endEpoch: number }
  | { name: 'failed'; message: string };

/**
 * SHA-256 as lower-case hex, from the browser's own crypto.
 *
 * Must agree byte for byte with `contentDigest` on the server, including the length prefixes —
 * those exist so that moving text between the preview and the body cannot produce the same digest.
 */
async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * The same digest, over raw bytes rather than text.
 *
 * Separate from `sha256Hex` deliberately: putting a file through `TextEncoder` mangles every byte
 * above 0x7F, so the hash would never match the one the server computes over the same file, and the
 * signature would be refused with nothing on screen explaining why.
 */
async function sha256HexBytes(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as unknown as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Filters the picker only. The real check is a magic-number sniff of the bytes, server-side. */
const ACCEPTED_IMAGES = 'image/png,image/jpeg,image/gif,image/webp';

/**
 * Decimal string → smallest units, by string manipulation, at the VAULT's decimals. No float
 * touches a price, and no constant decides the scale: a SUI vault has nine, USDC six, and the
 * tier form was fixed for exactly this while this file kept assuming six.
 */
function toMinor(input: string, decimals: number): bigint | null {
  const t = input.trim();
  if (!new RegExp(`^\\d+(\\.\\d{1,${decimals}})?$`).test(t)) return null;
  const [whole, frac = ''] = t.split('.');
  return BigInt(whole + frac.padEnd(decimals, '0'));
}

/** The shape `/api/creator` answers with, narrowed to what publishing needs. */
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
  /** Subscriber posts: the tier index the body is sealed to. 0 = every subscriber. */
  const [tier, setTier] = useState(0);
  const [contentKey, setContentKey] = useState('');
  const [price, setPrice] = useState('0.10');
  const [stage, setStage] = useState<Stage>({ name: 'idle' });
  /** Chosen before publishing, attached after — a post must exist for media to belong to. */
  const [image, setImage] = useState<File | null>(null);
  const [media, setMedia] = useState<MediaState>({ name: 'none' });
  /**
   * What the vault already charges for the key being typed.
   *
   * Four states, and the fourth is the reason this is not a boolean. `unknown` is "not asked yet",
   * `checking` is in flight, `{ price }` is a measured price, `null` is a measured absence, and
   * `unreadable` is a chain we could not reach. The last two look identical to a boolean and mean
   * opposite things: absence means price it, unreadable means conclude nothing.
   */
  const [keyPrice, setKeyPrice] = useState<
    { name: 'unknown' } | { name: 'checking' } | { name: 'known'; price: bigint | null } | { name: 'unreadable' }
  >({ name: 'unknown' });
  /**
   * The same four states, for the machine edition of the key being typed.
   *
   * Held separately rather than as a field on `keyPrice`, because the two reads can end
   * differently — the human key is priced and the machine key's read failed — and a single state
   * would have to pick one of those to report.
   */
  const [machineKeyPrice, setMachineKeyPrice] = useState<
    { name: 'unknown' } | { name: 'checking' } | { name: 'known'; price: bigint | null } | { name: 'unreadable' }
  >({ name: 'unknown' });
  /** What a machine buyer pays. Empty means the creator has not offered a machine edition. */
  const [machinePrice, setMachinePrice] = useState('');
  /**
   * Whether the machine edition of the key being typed can be DELIVERED, from `content-price`.
   *
   * `absent` is a post under this key that was sealed before machine editions were (migration 034):
   * its plaintext is gone, so no machine body can ever exist for it and pricing it would sell an
   * `Unlock` for nothing. The price field is withheld and the reason shown. `unknown` covers a read
   * that has not happened or failed — never rendered as "can be sold".
   */
  const [machineBody, setMachineBody] = useState<'unknown' | 'no-post' | 'sealed' | 'absent'>('unknown');
  /**
   * The machine edition's pricing transaction, kept out of `stage` deliberately.
   *
   * `needsPricing` below reads `stage.name !== 'priced'` to decide whether a paid post may be
   * published at all. Reusing `stage` for the machine transaction would mean that pricing the
   * machine edition *first* marks the post publishable while its human key still has no price on
   * the vault — which puts a buy button on the feed that aborts with `EContentNotForSale` every
   * time, the exact failure this composer was built to prevent.
   */
  const [machineStage, setMachineStage] = useState<Stage>({ name: 'idle' });

  /*
    The load that was missing. A failure is kept distinct from an empty result: telling a creator
    they have no vault because the chain was unreachable sends them to open a second one.
  */
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
        // Only a published vault can take a post: content is filed under the profile handle, and a
        // vault without one has no page for it to appear on.
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

  /*
    Ask the chain what this key already costs, while it is being typed.
  */
  useEffect(() => {
    const key = contentKey.trim();
    if (access !== 'paid' || target === null || key === '' || machineKeyProblem(key) !== null) {
      /*
        A key carrying the reserved marker is not asked about.

        The route refuses it with a 400, and a 400 arriving in the `!response.ok` branch below would
        be reported as `unreadable` — "we could not read the chain" — for a key the chain was never
        asked about. The reservation is stated under the field instead, by `reservedKey`.
      */
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
          /*
            `unreadable` unless the route said otherwise, and an absent `machine` block counts as
            unreadable rather than unpriced. An older deployment of this endpoint answers without
            one, and reading a missing field as "no price" would tell a creator their machine
            edition is free at the moment we cannot see it.
          */
          setMachineKeyPrice(
            body.machine?.state === 'priced' && body.machine.price != null
              ? { name: 'known', price: BigInt(body.machine.price) }
              : body.machine?.state === 'unpriced'
                ? { name: 'known', price: null }
                : { name: 'unreadable' },
          );
        } catch (error) {
          // An abort is this effect being replaced, not a failure. Reporting it as one would flash
          // "could not read" on every keystroke.
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

  /**
   * Put one content key up for sale on the vault.
   *
   * Parameterised by key, amount and where to report, so that the human edition and the machine
   * edition go through the *same* `set_content_price` call with the same simulation, the same
   * signature path and the same failure handling. A second copy of this function for the machine
   * edition is how the two would end up disagreeing about what a `no-creator-cap` answer means.
   */
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

  /**
   * Attach one image to a post that already exists.
   *
   * # Why this route had no caller until now
   *
   * `/api/studio/upload` was written, typed, tested and complete, and nothing in the interface ever
   * called it — it was the last entry on the reachability guard's list. It also stored bytes to a
   * per-instance serverless disk that vanished with the instance, so wiring it up earlier would
   * have produced uploads that silently disappeared. Both halves are fixed now: the bytes go to
   * Walrus, and this is the caller.
   *
   * # The signature covers the file, not just the intent
   *
   * The statement binds the post id **and a hash of the bytes**, so a captured signature cannot be
   * replayed to attach a different image to the same post. It must match `statementFor` in
   * lib/identity.ts exactly.
   */
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

      // No content-type header: the browser sets the multipart boundary, and naming it by hand
      // produces a body the server cannot parse.
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
      /*
        Publishing is signed, with no gas and no transaction.

        The route used to accept an `author` field and check it against the vault's owner from
        chain — which authorises nothing, because a vault's owner is public and anyone could put it
        in the body. The statement below must match `statementFor` in lib/identity.ts exactly, or
        the signature will not verify.
      */
      const timestampMs = Date.now();
      const contentSha256 = await sha256Hex(`${preview.length}:${preview}${text.length}:${text}`);
      /*
        Signed and sent must be the same values, so both come from here.

        `signedKey` and `signedPrice` are what the body carries below. A post that is not paid
        signs empty strings for both, matching what the server rebuilds — deriving them differently
        on the two sides is how a statement stops verifying for reasons nobody can see.
      */
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

      /*
        Media is attached after the post exists, because the upload is signed against the post id.
        Awaited rather than fired and forgotten: a creator who navigates away mid-store loses the
        image with no record that it was ever chosen.
      */
      if (image !== null) await attachMedia(body.post.id, image);

      setTitle('');
      setPreview('');
      setText('');
      setContentKey('');
      // The machine edition belongs to the key that was just published under, not to the next post.
      setMachinePrice('');
      setMachineStage({ name: 'idle' });
      setImage(null);
    } catch (error) {
      setStage({ name: 'failed', message: error instanceof Error ? error.message : String(error) });
    }
  }

  /*
    What is stopping a publish, named rather than counted.

    The button now always renders. Disabled, it says which field it is waiting for.
  */
  const blockers = [
    title.trim() === '' ? 'a title' : null,
    preview.trim() === '' ? 'a preview' : null,
    text.trim() === '' ? 'a body' : null,
  ].filter((reason): reason is string => reason !== null);

  /*
    The price this post is actually sold at, in minor units.

    Three sources, most-recently-true first: a price set in this session, then the price already on
    the vault, then the form field. They genuinely differ — the field holds its default while the
    key carries a price set weeks ago — and the contract charges whatever the table says. Sending
    the form's number would advertise a price on the feed that the buy button does not honour.

    No vault, no price. This used to read `target?.decimals ?? 6`, which turned a typed figure into
    minor units at native USDC's scale for a coin nobody had read yet. It could not reach a buyer —
    `canPublish` requires a target and the composer returns before rendering without one — but it is
    the same literal the five shipped scale bugs were, wearing the shared formatter's clothes, and
    it sat where the next person copies from. A missing vault is not a six-decimal vault.
  */
  const onChainPrice = keyPrice.name === 'known' ? keyPrice.price : null;
  const effectivePrice =
    target === null
      ? null
      : stage.name === 'priced'
        ? toMinor(price, target.decimals)
        : (onChainPrice ?? toMinor(price, target.decimals));

  /*
    A paid post is publishable only once its price is on chain. Anything else would ship a buy
    button that aborts.
  */
  const needsPricing = access === 'paid' && stage.name !== 'priced' && onChainPrice === null;

  /*
    The machine edition of the key being typed, and why the creator is shown it rather than asked
    for it.

    A second price for machine buyers needs no second post and no Move change: a paywall is keyed by
    `content_key`, so a second key on the same vault is a second price, a second `Unlock` and a
    second Seal identity over the same words. What it must never be is a key the creator invents,
    because two hand-typed keys drift, and a machine edition whose key is one character off the one
    the post was sealed under sells an `Unlock` that opens nothing. It is derived — see
    `lib/machine-pricing.ts` for the rule and for why it cannot collide with a chosen key.

    `reservedKey` is the other half of that: a creator who types the marker themselves is told, at
    the field, before any transaction.
  */
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

  /*
    Signed out, the composer is withheld rather than shown disabled. A form that cannot submit
    teaches nothing about why; the page above has already explained what publishing does, so what is
    left to say here is that it needs to know who it would be publishing as.
  */
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
        <span className="lbl">Not measured</span>
        <p>
          Your vaults could not be read, so there is nothing to publish to. This is not the same as
          having none, and the composer stays hidden rather than guessing a target.
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
              // A price signed against one vault means nothing on another.
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
              {/*
                Said before publishing, not after. A paid post's image is encrypted before it leaves
                this server; a public one is not, and anybody can then read it from any Walrus
                aggregator without us. That is a deliberate property and the creator should know
                which of the two they are about to choose.
              */}
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
            // The post is live regardless. Saying so prevents a creator republishing the words to
            // recover an image, which would leave two posts and still no image.
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
              // Changing access invalidates a price that was signed for a different shape.
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
              {/*
                Said before publishing, not after — an `Unlock` cannot be withdrawn.

                A key is a product, not a post: everyone holding one reads every post published
                under it. Selling a series that way is the point, so this describes rather than
                warns. What it prevents is the same thing happening by typo, which is
                indistinguishable from the deliberate version once the post is out.
              */}
              {keyPrice.name === 'checking' && (
                <p className="unmeasured" style={{ marginTop: 6 }}>Reading the vault…</p>
              )}
              {keyPrice.name === 'unreadable' && (
                <p className="unmeasured" style={{ marginTop: 6 }}>
                  This key&rsquo;s price could not be read, so whether anyone already holds it is
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

        {/*
          The machine edition. A second price on the same post, sold under a second content key.

          Shown as its own block rather than a second column beside the human price, because it is
          optional and independent: a creator can publish with no machine edition at all, price it
          later, price it higher or lower, and unprice it with `unprice_content` without touching
          what people pay. The key is displayed and not editable — it is derived, and a hand-typed
          one would sell an Unlock for an identity nothing was sealed to.
        */}
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
                This edition&rsquo;s price could not be read, so whether it is already on sale is
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

        {/*
          Named next to the control it disables, so the answer is where the question is asked.
          Pricing is left out: it has its own note and its own button directly above, and repeating
          it here would read as a second, different requirement.
        */}
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
