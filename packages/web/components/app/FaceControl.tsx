'use client';
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { useEffect, useRef, useState } from 'react';
import { Avatar } from '@projectx-social/ui';
import { useSigner } from '@/components/SignerProvider';
import { AVATAR_MAX_BYTES, AVATAR_TYPES } from '@/lib/avatar';

export function setImageStatement(handle: string, imageSha256: string, address: string, timestampMs: number): string {
  return (
    `Weir\naddress: ${address}\nissued: ${timestampMs}\norigin: ${window.location.origin}` +
    `\naction: set image\nhandle: ${handle}\nimage-sha256: ${imageSha256}`
  );
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

type Stage =
  | { name: 'idle' }
  | { name: 'chosen'; file: File; preview: string }
  | { name: 'signing'; file: File; preview: string }
  | { name: 'uploading'; file: File; preview: string }
  | { name: 'done'; url: string }
  | { name: 'failed'; message: string; file?: File; preview?: string };

/*
  Give a page a face. The picture is chosen here, its bytes are hashed in the browser, the owner
  signs a statement naming the handle and that hash, and the bytes go up with the signature. The
  page shows the picture only once the server has named the blob; until then it shows the mark.
*/
export function FaceControl({
  handle,
  current,
  onChanged,
}: {
  handle: string;
  /* The picture the page shows now, or null for the mark drawn from the address. */
  current: string | null;
  onChanged?: ((url: string) => void) | undefined;
}) {
  const { signer } = useSigner();
  const [stage, setStage] = useState<Stage>({ name: 'idle' });
  const input = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    return () => {
      if ('preview' in stage && stage.preview !== undefined) URL.revokeObjectURL(stage.preview);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (signer === null) return null;

  const shown = stage.name === 'done' ? stage.url : 'preview' in stage && stage.preview !== undefined ? stage.preview : current;

  const choose = (file: File | undefined) => {
    if (file === undefined) return;
    if (!AVATAR_TYPES.has(file.type)) {
      setStage({ name: 'failed', message: 'A picture is png, jpeg or webp.' });
      return;
    }
    if (file.size > AVATAR_MAX_BYTES) {
      setStage({ name: 'failed', message: `That picture is over ${Math.round(AVATAR_MAX_BYTES / 1024 / 1024)} MB.` });
      return;
    }
    setStage({ name: 'chosen', file, preview: URL.createObjectURL(file) });
  };

  const upload = async () => {
    if (stage.name !== 'chosen' && stage.name !== 'failed') return;
    const file = stage.file;
    const preview = stage.preview;
    if (file === undefined || preview === undefined) return;
    setStage({ name: 'signing', file, preview });
    try {
      const bytes = await file.arrayBuffer();
      const imageSha256 = await sha256Hex(bytes);
      const timestampMs = Date.now();
      const signature = await signer.signPersonalMessage(
        new TextEncoder().encode(setImageStatement(handle, imageSha256, signer.address, timestampMs)),
      );
      setStage({ name: 'uploading', file, preview });
      const form = new FormData();
      form.set('address', signer.address);
      form.set('handle', handle);
      form.set('file', file);
      form.set('signature', signature);
      form.set('timestampMs', String(timestampMs));
      const response = await fetch('/api/account/image', { method: 'POST', body: form });
      const body = (await response.json()) as { url?: string; error?: string };
      if (!response.ok || body.url === undefined) {
        setStage({ name: 'failed', message: body.error ?? `the picture was not accepted (${response.status})`, file, preview });
        return;
      }
      setStage({ name: 'done', url: body.url });
      onChanged?.(body.url);
    } catch (cause) {
      setStage({ name: 'failed', message: cause instanceof Error ? cause.message : String(cause), file, preview });
    }
  };

  const busy = stage.name === 'signing' || stage.name === 'uploading';

  return (
    <div className="w-face">
      <div className="w-face__row">
        <Avatar address={signer.address} src={shown} size={92} />
        <div className="w-face__actions">
          <input
            ref={input}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="w-vh"
            aria-label="Choose a picture"
            onChange={(event) => choose(event.target.files?.[0])}
          />
          <button type="button" className="w-btn w-btn--quiet" disabled={busy} onClick={() => input.current?.click()}>
            {shown === null ? 'Choose a picture' : 'Choose another'}
          </button>
          {stage.name === 'chosen' || (stage.name === 'failed' && stage.file !== undefined) ? (
            <button type="button" className="w-btn w-btn--primary" disabled={busy} onClick={() => void upload()}>
              Use this picture
            </button>
          ) : null}
        </div>
      </div>
      <p className={stage.name === 'failed' ? 'w-field__note w-field__note--bad' : 'w-field__note'} role="status">
        {stage.name === 'idle'
          ? 'png, jpeg or webp, up to 2 MB. It is stored on Walrus under your account and shown on your page and your posts.'
          : stage.name === 'chosen'
            ? 'Chosen. Nothing is uploaded until you sign for it.'
            : stage.name === 'signing'
              ? 'Sign the statement naming this picture.'
              : stage.name === 'uploading'
                ? 'Storing it on Walrus.'
                : stage.name === 'done'
                  ? 'Your page has a face.'
                  : stage.message}
      </p>
    </div>
  );
}
