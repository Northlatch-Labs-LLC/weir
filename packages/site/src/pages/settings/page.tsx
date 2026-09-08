import { useEffect, useRef, useState } from 'react';
import Shell from '@/components/layout/Shell';
import { useViewer } from '@/lib/viewer-context';
import SignedOutGate from '@/components/base/SignedOutGate';
import Avatar from '@/components/base/Avatar';
import AvatarUpload from './components/AvatarUpload';
import Icon from '@/components/base/Icon';

export default function Settings() {
  const { viewer } = useViewer();

  const [name, setName] = useState(viewer.signedIn ? viewer.displayName ?? '' : '');
  const [handle, setHandle] = useState(viewer.signedIn ? viewer.handle ?? '' : '');
  const [bio, setBio] = useState('');
  const [saved, setSaved] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [confirmHandle, setConfirmHandle] = useState(false);
  const [handleDraft, setHandleDraft] = useState('');

  const saveTimer = useRef<number | undefined>(undefined);

  // Autosave 800ms after typing stops — quiet "Saved", not a toast.
  useEffect(() => {
    window.clearTimeout(saveTimer.current);
    setSaved(false);
    saveTimer.current = window.setTimeout(() => setSaved(true), 800);
    return () => window.clearTimeout(saveTimer.current);
  }, [name, bio]);

  if (!viewer.signedIn) {
    return (
      <Shell>
        <div className="mx-auto max-w-3xl px-4 pt-12 md:px-6">
          <SignedOutGate what="Your profile is how you appear in public. Sign in to edit it." />
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="mx-auto max-w-2xl px-4 pt-10 md:px-6">
        <header className="flex items-center justify-between gap-4">
          <h1 className="font-serif text-h1 font-medium text-ink-10">Profile</h1>
          <span aria-live="polite" className="sr-only">{saved ? 'Changes saved.' : ''}</span>
          <span aria-hidden="true" className={`text-caption text-ink-7 ${saved ? 'opacity-100' : 'opacity-0'}`}>Saved</span>
        </header>
        <p className="mt-2 text-body text-ink-8">
          This is how you appear in public. Changes save as you type.
        </p>

        {/* Avatar */}
        <section className="mt-8 flex items-center gap-4 rounded-lg border border-ink-4 bg-ink-1 p-5">
          {avatarUrl ? (
            <img src={avatarUrl} alt="Your photo" className="h-20 w-20 rounded-full border border-ink-4 object-cover" />
          ) : (
            <Avatar seed={viewer.address ?? viewer.handle ?? 'unknown'} size={80} />
          )}
          <div>
            <button
              type="button"
              onClick={() => setUploadOpen(true)}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-md border border-ink-5 bg-ink-2 px-4 py-2 text-body-sm text-ink-10 hover:border-ink-6 whitespace-nowrap cursor-pointer"
            >
              <Icon name="upload" size={16} />
              Change photo
            </button>
            <p className="mt-2 text-caption text-ink-7">Replacing your photo alters your public identity.</p>
          </div>
        </section>

        {/* Fields */}
        <div className="mt-6 flex flex-col gap-5 rounded-lg border border-ink-4 bg-ink-1 p-6">
          <div>
            <div className="flex items-baseline justify-between">
              <label htmlFor="profile-name" className="block text-body-sm text-ink-9">Display name</label>
              <span className="font-mono text-caption tabular-nums text-ink-7">{name.length}/60</span>
            </div>
            <input id="profile-name" name="display_name" type="text" maxLength={60} value={name} onChange={e => setName(e.target.value)} className="mt-1 w-full rounded-md border border-ink-5 bg-ink-2 px-3 py-2.5 text-body text-ink-10" />
          </div>

          <div>
            <label htmlFor="profile-handle" className="block text-body-sm text-ink-9">Handle</label>
            <div className="mt-1 flex items-center gap-2">
              <input id="profile-handle" name="handle" type="text" value={handle} readOnly className="w-full rounded-md border border-ink-5 bg-ink-2 px-3 py-2.5 font-mono text-body text-ink-10" />
              <button type="button" onClick={() => { setHandleDraft(handle); setConfirmHandle(true); }} className="inline-flex min-h-[44px] shrink-0 items-center rounded-md border border-ink-5 bg-ink-2 px-3 py-2 text-body-sm text-ink-10 whitespace-nowrap cursor-pointer">
                Change
              </button>
            </div>
            <p className="mt-1 text-caption text-ink-7">Changing your handle alters a public identity and needs a confirm.</p>
          </div>

          <div>
            <div className="flex items-baseline justify-between">
              <label htmlFor="profile-bio" className="block text-body-sm text-ink-9">Bio</label>
              <span className="font-mono text-caption tabular-nums text-ink-7">{bio.length}/280</span>
            </div>
            <textarea id="profile-bio" name="bio" rows={4} maxLength={280} value={bio} onChange={e => setBio(e.target.value)} className="mt-1 w-full resize-y rounded-md border border-ink-5 bg-ink-2 px-3 py-2.5 text-body text-ink-10" />
          </div>
        </div>
      </div>

      {uploadOpen && (
        <AvatarUpload
          onUse={url => { setAvatarUrl(url); setUploadOpen(false); }}
          onCancel={() => setUploadOpen(false)}
        />
      )}

      {/* Handle change confirm */}
      {confirmHandle && (
        <div role="dialog" aria-modal="true" aria-labelledby="handle-confirm-title" className="fixed inset-0 z-50 flex items-center justify-center bg-ink-0/70 p-4">
          <div className="w-full max-w-sm rounded-lg border border-ink-4 bg-ink-1 p-6">
            <h3 id="handle-confirm-title" className="font-serif text-h4 font-medium text-ink-10">Change handle</h3>
            <p className="mt-2 text-body-sm text-ink-8">This changes how everyone finds you. Old links will not follow.</p>
            <label htmlFor="handle-confirm-input" className="sr-only">New handle</label>
            <input
              id="handle-confirm-input"
              type="text"
              maxLength={32}
              value={handleDraft}
              onChange={e => setHandleDraft(e.target.value)}
              className="mt-4 w-full rounded-md border border-ink-5 bg-ink-2 px-3 py-2.5 font-mono text-body text-ink-10"
            />
            <div className="mt-5 flex gap-2">
              <button type="button" onClick={() => setConfirmHandle(false)} className="inline-flex min-h-[44px] flex-1 items-center justify-center rounded-md border border-ink-5 px-4 py-2 text-body-sm text-ink-10 whitespace-nowrap cursor-pointer">Cancel</button>
              <button type="button" onClick={() => { setHandle(handleDraft); setConfirmHandle(false); }} className="inline-flex min-h-[44px] flex-1 items-center justify-center rounded-md border-2 border-rose bg-rose px-4 py-2 text-body-sm font-semibold text-ink-0 whitespace-nowrap cursor-pointer">Confirm</button>
            </div>
          </div>
        </div>
      )}
    </Shell>
  );
}