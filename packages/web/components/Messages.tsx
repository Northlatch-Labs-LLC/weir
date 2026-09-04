'use client';
// Built-by: @projectx.sui /|\ · Co-authored-by: Claude

/**
 * Direct messages, end-to-end encrypted where both parties have a key.
 *
 * Reading is signed, not just sending. Everywhere else naming an address grants nothing because
 * entitlement lives on chain; a DM has no such backstop, so proof is required to read.
 *
 * A signature is requested per action rather than held. There is no session and nothing cached —
 * which means a wallet prompt each time, and that is the honest trade for having nothing to steal.
 *
 * # The encryption key lives in this component's memory and nowhere else
 *
 * It is derived from a signature, held in React state, and gone when the tab closes. Nothing is
 * written to `localStorage`: a key at rest in the browser is a key any script on the origin can
 * read, and the derivation is cheap enough to repeat.
 *
 * # Encryption is never silently on or silently off
 *
 * Every message is labelled with what it actually is, and the composer says which of the two it is
 * about to send *before* it is sent. A recipient who has never registered a key cannot receive an
 * encrypted message — nobody can force them to — so those messages go in plaintext, and the
 * composer says so rather than downgrading quietly.
 */

import { useMemo, useState } from 'react';
import { useSigner } from '@/components/SignerProvider';
import { SignIn } from '@/components/SignIn';
import { formatSui, formatUnits } from '@/lib/units';
import {
  ciphertextDigest,
  decrypt,
  encrypt,
  deriveSecret,
  publicFromSecret,
  toB64,
  KEY_STATEMENT,
  type EncryptedPayload,
} from '@/lib/e2e';

/**
 * What a locked message costs, and what that number means.
 */
interface Price {
  /** Smallest units, as a decimal string. Never a number: these exceed 2^53. */
  minor: string;
  /** From the vault coin's own `CoinMetadata`, via the read route. `null` when it could not be read. */
  decimals: number | null;
  /** Display only, from the coin type's last segment. */
  symbol: string;
}

interface Message {
  id: string;
  from: string;
  to: string;
  createdAtMs: number;
  preview: string;
  body?: string;
  locked: boolean;
  access:
    | { kind: 'open' }
    | ({ kind: 'paid'; price: string; contentKey: string; vaultId: string } & Omit<Price, 'minor'>);
  encryption: EncryptedPayload | null;
}

interface Thread {
  threadId: string;
  other: string;
  lastAtMs: number;
  lastPreview: string;
  lastEncrypted: boolean;
  /**
   * What this person has tipped you, in the smallest unit of your vault's coin.
   *
   * Present only when you own a creator vault and the chain showed a tip. Absent means "no mark to
   * show" — a guest, no vault, a read that failed, or a tally the bounded walk did not reach — and
   * never "this person has given you nothing", which is a different claim the route cannot make.
   */
  supporterUnits?: string;
}

/** Must match `statementFor` in lib/identity.ts exactly. */
function stmt(action: string, address: string, ts: number): string {
  return `Weir\naddress: ${address}\nissued: ${ts}\norigin: ${window.location.origin}\n${action}`;
}

function short(a: string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

/**
 * A price, at the scale its own coin declares.
 *
 * An unread scale prints as an admission rather than a figure. There is no fallback to six: a coin
 * whose metadata could not be read is not a six-decimal coin, and guessing is how the original bug
 * stayed invisible.
 */
function money(price: Price): string {
  if (price.decimals === null) return 'scale unknown';
  const amount = formatUnits(BigInt(price.minor), price.decimals);
  return price.symbol === '' ? amount : `${amount} ${price.symbol}`;
}

/**
 * The result of looking up a recipient's published key.
 *
 * `none` and `failed` are deliberately separate. "This person has not set up encryption" is a fact
 * about them and a reason to send in plaintext; "we could not find out" is a fact about us and a
 * reason to send nothing at all.
 */
type KeyLookup = { state: 'unchecked' } | { state: 'checking' } | KeyResolution;

/**
 * The subset a completed lookup can be in.
 *
 * Split out so `fetchKey` cannot be typed as possibly returning `unchecked` — the callers narrow
 * on `found` versus `none`, and a wider return type forces a defensive branch for a state that
 * never occurs, which is the kind of branch that later gets filled in with a guess.
 */
type KeyResolution =
  | { state: 'found'; key: string }
  | { state: 'none' }
  | { state: 'failed'; detail: string };

/** What the reader sees for one message, after decryption has been attempted. */
type Rendered =
  | { state: 'plain'; text: string }
  | { state: 'decrypted'; text: string }
  /** Encrypted, and this device holds no key. Not a failure — a prompt. */
  | { state: 'no-key' }
  /** Encrypted, key present, and it does not open this message. */
  | { state: 'undecryptable' }
  /** Paid and unbought. */
  | { state: 'locked'; preview: string; price: Price | null };

function render(m: Message, viewer: string, secret: Uint8Array | null): Rendered {
  if (m.encryption !== null) {
    if (secret === null) return { state: 'no-key' };
    const text = decrypt(m.encryption, viewer, secret);
    return text === null ? { state: 'undecryptable' } : { state: 'decrypted', text };
  }
  if (m.body !== undefined) return { state: 'plain', text: m.body };
  return {
    state: 'locked',
    preview: m.preview,
    price:
      m.access.kind === 'paid'
        ? { minor: m.access.price, decimals: m.access.decimals, symbol: m.access.symbol }
        : null,
  };
}

export function Messages() {
  const { signer } = useSigner();
  const [threads, setThreads] = useState<Thread[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [to, setTo] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** The X25519 secret, in memory only. `null` means encryption is not enabled on this device. */
  const [secret, setSecret] = useState<Uint8Array | null>(null);
  /**
   * The recipient's published key.
   *
   * Four states, not two, because the differences decide what pressing Send does. Collapsing
   * "we could not look" into "there is none" is how a lookup outage turns into a plaintext message
   * the sender believed was encrypted — a silent downgrade, and the worst failure this component
   * can have. So a failed look refuses to send rather than choosing for them.
   */
  const [theirKey, setTheirKey] = useState<KeyLookup>({ state: 'unchecked' });

  const recipient = open ?? to.trim();
  const willEncrypt = secret !== null && theirKey.state === 'found';
  /** Pressing Send must never be ambiguous about which of the two it is doing. */
  const canSend =
    recipient !== '' &&
    text.trim() !== '' &&
    (willEncrypt || (secret === null && theirKey.state !== 'failed') || theirKey.state === 'none');

  const rendered = useMemo(
    () =>
      signer === null || messages === null
        ? []
        : messages.map((m) => ({ m, r: render(m, signer.address, secret) })),
    [messages, signer, secret],
  );

  async function signRaw(message: string): Promise<string | null> {
    if (signer === null) return null;
    const signature = await signer.signPersonalMessage(new TextEncoder().encode(message));
    return signature;
  }

  async function sign(action: string): Promise<{ signature: string; timestampMs: number } | null> {
    if (signer === null) return null;
    const timestampMs = Date.now();
    const signature = await signRaw(stmt(action, signer.address, timestampMs));
    return signature === null ? null : { signature, timestampMs };
  }


  /**
   * Derive this address's encryption key and, if the chain does not already hold it, publish it.
   *
   * # Deriving and publishing are separate, and only the first always happens
   *
   * The derivation is a personal-message signature and costs nothing. Publishing writes to the
   * shared `KeyRegistry` on Sui and costs gas — so it is only proposed when the chain actually
   * disagrees with the key just derived, and it is quoted before it is signed like every other
   * transaction here.
   *
   * A user who has already published can therefore read their messages on a new device for free.
   * Only a first publication or a genuine rotation costs anything.
   *
   * # Why the read comes first and is allowed to stop this
   *
   * A failed registry read does not fall through to "publish anyway". Republishing a key that is
   * already there wastes gas; publishing over a *different* one is a rotation that makes the
   * user's own history unreadable. Neither is a thing to do on a guess.
   */
  async function enableEncryption() {
    if (signer === null) return;
    setBusy(true);
    setError(null);
    try {
      const signature = await signRaw(KEY_STATEMENT);
      if (signature === null) return;
      const derived = deriveSecret(signature);
      const mine = toB64(publicFromSecret(derived));

      const published = await fetchKey(signer.address);
      if (published.state === 'failed') {
        setError(`The key registry could not be read (${published.detail}). Nothing was published.`);
        return;
      }

      if (published.state === 'none' || published.key !== mine) {
        const ok = await publishKey(signer.address, mine, published.state === 'found');
        if (!ok) return;
      }

      setSecret(derived);
      // Anything already on screen was rendered without a key. Re-render it with one.
      if (open !== null) await lookupKey(open);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  /**
   * Build, simulate, quote, sign and submit a key publication.
   *
   * The same shape as every payment in this application: the confirming step does not exist until
   * a simulation has passed. The cost here is only gas, but a transaction that aborts still costs
   * it — and this contract does abort, on a key of the wrong length or an all-zero one.
   *
   * A rotation is confirmed separately and in words, because it is the one action in this
   * component that destroys something: every message wrapped to the old key stops opening, and
   * nothing anywhere can re-wrap them.
   */
  async function publishKey(
    sender: string,
    x25519Public: string,
    rotating: boolean,
  ): Promise<boolean> {
    if (signer === null) return false;

    const prepared = await fetch('/api/keys/prepare', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sender, x25519Public }),
    });
    const body = (await prepared.json()) as {
      quote?: { bytes: string; gasMist: string; suiDeltaMist: string };
      error?: string;
    };
    if (body.quote === undefined) {
      setError(body.error ?? 'the key publication could not be simulated');
      return false;
    }

    // Not `Number(mist) / 1e9`: this is a figure somebody is about to agree to pay.
    const gas = formatSui(body.quote.gasMist);
    const confirmed = window.confirm(
      rotating
        ? `Rotating your encryption key costs about ${gas} SUI in gas.\n\n` +
            'Every message already sent to your previous key will stop opening, permanently. ' +
            'Nothing here can re-wrap them.\n\nPublish the new key?'
        : `Publishing your encryption key costs about ${gas} SUI in gas.\n\n` +
            'It goes into the shared registry on Sui, where anyone can read it, which is what ' +
            'stops this server from hiding it from people who want to write to you.',
    );
    if (!confirmed) return false;

    const signature = await signer.signTransaction(body.quote.bytes);

    // Submitted through the shared endpoint, which takes the bytes back unchanged — so what
    // executes is byte-identical to what was simulated and to what the wallet displayed.
    const submitted = await fetch('/api/checkout/submit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ bytes: body.quote.bytes, signature }),
    });
    const result = (await submitted.json()) as { digest?: string; error?: string };
    if (result.digest === undefined) {
      setError(result.error ?? 'the key publication was not accepted');
      return false;
    }
    return true;
  }

  /**
   * One address's published key, from the chain-backed route.
   *
   * The route reports three outcomes and this keeps them three. Folding an error into "no key" is
   * exactly the downgrade the on-chain registry was built to remove, and a client that flattened
   * the response would reintroduce it on its own. That includes a response that is not JSON at
   * all: a 500 used to reject inside `r.json()` and leave the state stuck on "checking", which
   * read as harmless while Send fell through to plaintext.
   */
  async function fetchKey(address: string): Promise<KeyResolution> {
    try {
      const r = await fetch(`/api/keys?addresses=${encodeURIComponent(address)}`);
      const text = await r.text();
      let parsed: {
        keys?: Record<string, { key?: string | null; error?: string }>;
        error?: string;
      };
      try {
        parsed = JSON.parse(text) as typeof parsed;
      } catch {
        return { state: 'failed', detail: `the key registry returned ${r.status}` };
      }
      if (parsed.keys === undefined) {
        return { state: 'failed', detail: parsed.error ?? `the key registry returned ${r.status}` };
      }

      const entry = Object.values(parsed.keys)[0];
      if (entry === undefined) return { state: 'failed', detail: 'the registry returned no entry' };
      if (entry.error !== undefined) return { state: 'failed', detail: entry.error };
      if (entry.key === null || entry.key === undefined) return { state: 'none' };
      return { state: 'found', key: entry.key };
    } catch (e) {
      return { state: 'failed', detail: e instanceof Error ? e.message : String(e) };
    }
  }

  /**
   * Fetch the recipient's published key. What is fetched here is what a send will use.
   *
   * Thin, because the enable flow needs the same three outcomes. Two copies of that logic would
   * eventually disagree about which one means "send plaintext", and only one of the two answers
   * is safe.
   */
  async function lookupKey(other: string) {
    setTheirKey({ state: 'checking' });
    setTheirKey(await fetchKey(other));
  }

  async function loadInbox() {
    if (signer === null) return;
    setBusy(true);
    setError(null);
    try {
      const signed = await sign(`action: read\nthread with: ${signer.address}`);
      if (signed === null) return;
      const r = await fetch('/api/messages/threads', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ viewer: signer.address, ...signed }),
      });
      const b = (await r.json()) as { threads?: Thread[]; error?: string };
      if (b.threads === undefined) setError(b.error ?? 'could not load');
      else setThreads(b.threads);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function openThread(other: string) {
    if (signer === null) return;
    setBusy(true);
    setError(null);
    try {
      const signed = await sign(`action: read\nthread with: ${other}`);
      if (signed === null) return;
      const r = await fetch('/api/messages/read', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ viewer: signer.address, other, ...signed }),
      });
      const b = (await r.json()) as { messages?: Message[]; error?: string };
      if (b.messages === undefined) setError(b.error ?? 'could not read');
      else {
        setMessages(b.messages);
        setOpen(other);
        await lookupKey(other);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    if (signer === null) return;
    const trimmed = text.trim();
    if (recipient === '' || trimmed === '') return;
    setBusy(true);
    setError(null);
    try {
      /*
        Two paths, chosen by `willEncrypt`, which is the same value the composer has been showing.
        The decision is not recomputed here against a freshly fetched key: a send must do what the
        label said it would, and a key that changed between reading the label and pressing the
        button should force another look, not silently alter what happens.
      */
      let payload: Record<string, unknown>;
      if (willEncrypt && secret !== null && theirKey.state === 'found') {
        const encryption = encrypt(trimmed, [
          { address: recipient, x25519Public: theirKey.key },
          // The sender's own envelope. Without it the thread is unreadable to the person who wrote
          // half of it — see the note in lib/e2e.ts.
          { address: signer.address, x25519Public: toB64(publicFromSecret(secret)) },
        ]);
        const signed = await sign(
          `action: send encrypted\nto: ${recipient}\nciphertext-sha256: ${ciphertextDigest(
            encryption.ciphertext,
          )}`,
        );
        if (signed === null) return;
        payload = { from: signer.address, to: recipient, encryption, ...signed };
      } else {
        /*
          Signed and sent are the same value, so it is computed once.

          `preview` is what a recipient sees before deciding to pay, and it was not covered by the
          signature — so a captured send could be replayed with a different one. `paid` is empty
          here because this composer never charges; the field is still signed, so "free" is
          something the sender stated rather than something the request omitted.
        */
        const previewText = trimmed.slice(0, 80);
        // A value, not an empty literal. The server interpolates here, and the drift test compares
        // the two as skeletons — a hard-coded blank is a different shape from a slot that happens
        // to be empty, and it would pass locally while failing the guard that exists to catch this.
        const paidStatement = '';
        const signed = await sign(
          `action: send\nto: ${recipient}\ntext: ${trimmed}\npreview: ${previewText}\npaid: ${paidStatement}`,
        );
        if (signed === null) return;
        payload = {
          from: signer.address,
          to: recipient,
          preview: previewText,
          text: trimmed,
          ...signed,
        };
      }

      const r = await fetch('/api/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const b = (await r.json()) as { message?: unknown; error?: string };
      if (b.message === undefined) setError(b.error ?? 'could not send');
      else {
        setText('');
        await openThread(recipient);
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
          Messages are private between you and the other party. Reading them is signed, not just
          sending, so nobody can read a conversation by typing an address.
        </p>
        <SignIn />
        {error !== null && <p className="unmeasured">{error}</p>}
      </div>
    );
  }

  return (
    <div className="messages-layout" style={{ display: 'grid', gap: 16, gridTemplateColumns: 'minmax(200px, 280px) 1fr' }}>
      <div className="panel">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span className="k">INBOX</span>
          <button className="btn ghost" type="button" disabled={busy} onClick={() => void loadInbox()}>
            {busy ? '…' : threads === null ? 'Load inbox' : 'Refresh'}
          </button>
        </div>

        {secret === null ? (
          <div className="note warn" style={{ marginTop: 12 }}>
            <span className="lbl">Encryption off</span>
            <p>
              Encrypted messages will show as unreadable until you derive your key, and anything you
              send goes to the server in plaintext.
            </p>
            <button
              className="btn"
              type="button"
              disabled={busy}
              style={{ marginTop: 10 }}
              onClick={() => void enableEncryption()}
            >
              {busy ? 'Signing…' : 'Enable encryption'}
            </button>
          </div>
        ) : (
          <p className="enc-status" style={{ marginTop: 12 }}>
            <span className="enc-tag">encrypted</span> key held in this tab only. Closing the tab
            forgets the key, not your messages.
          </p>
        )}

        {threads?.length === 0 && <p className="unmeasured">No conversations yet.</p>}
        {threads?.map((t) => (
          <button
            key={t.threadId}
            type="button"
            className={open === t.other ? 'thread-row open' : 'thread-row'}
            onClick={() => void openThread(t.other)}
          >
            <span className="mono">
              {short(t.other)}
              {/* Named in words, not colour: "supporter" is the fact, and it has to survive being
                  read aloud. The amount stays off the row — a figure beside every name turns an
                  inbox into a leaderboard. */}
              {t.supporterUnits !== undefined && <span className="thread-supporter">supporter</span>}
            </span>
            <span className="thread-preview">
              {t.lastEncrypted ? <em>encrypted message</em> : t.lastPreview}
            </span>
          </button>
        ))}
      </div>

      <div className="panel">
        {open === null ? (
          <>
            <label className="k" htmlFor="to">NEW MESSAGE · RECIPIENT ADDRESS</label>
            <input
              id="to"
              className="comment-input"
              style={{ width: '100%', marginTop: 6 }}
              value={to}
              onChange={(e) => {
                setTo(e.target.value);
                setTheirKey({ state: 'unchecked' });
              }}
              onBlur={() => {
                if (to.trim() !== '') void lookupKey(to.trim());
              }}
              placeholder="0x…"
            />
          </>
        ) : (
          <div className="k" style={{ marginBottom: 10 }}>THREAD WITH {short(open)}</div>
        )}

        <div style={{ display: 'grid', gap: 8, margin: '12px 0' }}>
          {rendered.map(({ m, r }) => (
            <div
              key={m.id}
              className={m.from.toLowerCase() === signer.address.toLowerCase() ? 'msg mine' : 'msg'}
            >
              {r.state === 'plain' && (
                <>
                  <div>{r.text}</div>
                  <div className="enc-status">
                    <span className="enc-tag off">not encrypted</span> readable by this server
                  </div>
                </>
              )}
              {r.state === 'decrypted' && (
                <>
                  <div>{r.text}</div>
                  <div className="enc-status">
                    <span className="enc-tag">encrypted</span> decrypted in your browser
                  </div>
                </>
              )}
              {r.state === 'no-key' && (
                <div className="locked-strip">
                  Encrypted. Enable encryption to derive your key and read this.
                </div>
              )}
              {r.state === 'undecryptable' && (
                <div className="locked-strip">
                  Encrypted, and your current key does not open it. It was sent to a key you have
                  since replaced.
                </div>
              )}
              {r.state === 'locked' && (
                <>
                  <div>{r.preview}</div>
                  <div className="locked-strip" style={{ marginTop: 8 }}>
                    {r.price === null
                      ? 'Locked.'
                      : r.price.decimals === null
                        ? // Named, not hidden and not guessed. The price exists; what it means does
                          // not, and a figure printed anyway would be indistinguishable from a real
                          // one.
                          "Locked. The price could not be shown: this coin's scale was not read."
                        : `Locked. ${money(r.price)} to open.`}
                  </div>
                </>
              )}
            </div>
          ))}
        </div>

        {recipient !== '' && (
          <p className="enc-status" style={{ marginBottom: 8 }}>
            {theirKey.state === 'failed' ? (
              // Not a badge. Neither "encrypted" nor "not encrypted" is known to be true here, and
              // showing either would be a claim this component cannot make.
              <span className="unmeasured">
                Not measured: {short(recipient)}&rsquo;s key could not be read ({theirKey.detail}).
                Nothing is sent until it can be.
              </span>
            ) : willEncrypt ? (
              <>
                <span className="enc-tag">encrypted</span> this message will be encrypted to{' '}
                {short(recipient)} and to you
              </>
            ) : secret === null ? (
              <>
                <span className="enc-tag off">not encrypted</span> enable encryption above to send
                encrypted
              </>
            ) : theirKey.state === 'none' ? (
              <>
                <span className="enc-tag off">not encrypted</span> {short(recipient)} has not
                published an encryption key, so this will be sent in plaintext
              </>
            ) : (
              <>checking {short(recipient)}&rsquo;s key…</>
            )}
          </p>
        )}

        <div style={{ display: 'flex', gap: 8 }}>
          <input
            aria-label="Message"
            className="comment-input"
            value={text}
            placeholder="Write a message…"
            onChange={(e) => setText(e.target.value)}
          />
          <button
            className="btn"
            type="button"
            disabled={busy || !canSend}
            onClick={() => void send()}
          >
            {busy ? 'Signing…' : willEncrypt ? 'Send encrypted' : 'Send'}
          </button>
        </div>
        {error !== null && <p className="unmeasured">{error}</p>}
      </div>
    </div>
  );
}
