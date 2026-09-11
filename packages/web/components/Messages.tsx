'use client';
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

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

interface Price {
  minor: string;
  decimals: number | null;
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
  supporterUnits?: string;
}

function stmt(action: string, address: string, ts: number): string {
  return `Weir\naddress: ${address}\nissued: ${ts}\norigin: ${window.location.origin}\n${action}`;
}

function short(a: string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

function money(price: Price): string {
  if (price.decimals === null) return 'scale unknown';
  const amount = formatUnits(BigInt(price.minor), price.decimals);
  return price.symbol === '' ? amount : `${amount} ${price.symbol}`;
}

type KeyLookup = { state: 'unchecked' } | { state: 'checking' } | KeyResolution;

type KeyResolution =
  | { state: 'found'; key: string }
  | { state: 'none' }
  | { state: 'failed'; detail: string };

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

  const [secret, setSecret] = useState<Uint8Array | null>(null);
  const [theirKey, setTheirKey] = useState<KeyLookup>({ state: 'unchecked' });

  const recipient = open ?? to.trim();
  const willEncrypt = secret !== null && theirKey.state === 'found';
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
        setError(`The key registry is being read from the chain (${published.detail}). Nothing was published.`);
        return;
      }

      if (published.state === 'none' || published.key !== mine) {
        const ok = await publishKey(signer.address, mine, published.state === 'found');
        if (!ok) return;
      }

      setSecret(derived);
      if (open !== null) await lookupKey(open);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

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
      let payload: Record<string, unknown>;
      if (willEncrypt && secret !== null && theirKey.state === 'found') {
        const encryption = encrypt(trimmed, [
          { address: recipient, x25519Public: theirKey.key },
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
        const previewText = trimmed.slice(0, 80);
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
          Your messages are encrypted, and only you and the person you are talking to can open them.
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
                        ?
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
              <span className="unmeasured">
                Reading from the chain: {short(recipient)}&rsquo;s key is being read from the chain ({theirKey.detail}).
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
