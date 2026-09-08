import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Shell from '@/components/layout/Shell';
import { useViewer } from '@/lib/viewer-context';
import { fmtSui } from '@/lib/format';
import SignedOutGate from '@/components/base/SignedOutGate';
import Icon from '@/components/base/Icon';

type Step = 1 | 2 | 3;
type Access = 'free' | 'locked' | 'subscribers';

export default function Studio() {
  const { viewer } = useViewer();
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>(1);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [access, setAccess] = useState<Access>('free');
  const [price, setPrice] = useState(0.25);
  const [published, setPublished] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const firstStep = useRef(true);

  useEffect(() => {
    if (firstStep.current) {
      firstStep.current = false;
      return;
    }
    panelRef.current?.focus({ preventScroll: true });
  }, [step]);

  if (!viewer.signedIn) {
    return (
      <Shell>
        <div className="mx-auto max-w-3xl px-4 pt-12 md:px-6">
          <SignedOutGate what="Publishing requires an account, because a post is signed by your key. Sign in to write." next="studio" />
        </div>
      </Shell>
    );
  }

  if (published) {
    return (
      <Shell>
        <div className="mx-auto max-w-3xl px-4 pt-16 md:px-6">
          <div className="flex items-center gap-2 text-caption font-semibold uppercase tracking-wide text-mint">
            <Icon name="check" size={16} />
            Published
          </div>
          <h1 className="mt-2 font-serif text-h2 font-medium text-ink-10">Your post is live.</h1>
          <p className="mt-3 text-body text-ink-8">
            It is signed by your key and listed in the feed. The title was not rewritten.
          </p>
          <button
            type="button"
            onClick={() => navigate('/feed')}
            className="mt-6 inline-flex min-h-[44px] items-center rounded-md bg-mint px-5 py-2.5 text-body-sm font-semibold text-ink-0 hover:bg-mint-dim whitespace-nowrap cursor-pointer"
          >
            Go to the feed
          </button>
        </div>
      </Shell>
    );
  }

  const steps: { n: Step; label: string }[] = [
    { n: 1, label: 'Write' },
    { n: 2, label: 'Price' },
    { n: 3, label: 'Publish' },
  ];

  return (
    <Shell>
      <div className="mx-auto max-w-3xl px-4 pt-10 md:px-6">
        <h1 className="font-serif text-h1 font-medium text-ink-10">Write, price it, publish.</h1>

        {/* Stepper */}
        <ol className="mt-6 flex items-center gap-2" aria-label="Publishing steps">
          {steps.map((s, i) => (
            <li key={s.n} aria-current={s.n === step ? 'step' : undefined} className="flex items-center gap-2">
              <span
                className={`inline-flex h-7 w-7 items-center justify-center rounded-full border font-mono text-caption ${
                  s.n < step ? 'border-mint bg-mint text-ink-0' : s.n === step ? 'border-ink-10 text-ink-10' : 'border-ink-5 text-ink-7'
                }`}
              >
                {s.n < step ? '✓' : s.n}
              </span>
              <span className={`text-body-sm ${s.n === step ? 'text-ink-10' : 'text-ink-7'}`}>{s.label}</span>
              {i < steps.length - 1 && <span aria-hidden className="mx-1 h-px w-8 bg-ink-4" />}
            </li>
          ))}
        </ol>

        <div className="mt-8" ref={panelRef} tabIndex={-1}>
          {step === 1 && (
            <div className="flex flex-col gap-4">
              <div>
                <div className="flex items-baseline justify-between">
                  <label htmlFor="composer-title" className="block text-body-sm text-ink-9">Title</label>
                  <span className="font-mono text-caption tabular-nums text-ink-7">{title.length}/200</span>
                </div>
                <input
                  id="composer-title"
                  name="title"
                  type="text"
                  maxLength={200}
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  placeholder="Write the full title as a sentence"
                  className="mt-1 w-full rounded-md border border-ink-5 bg-ink-2 px-3 py-2.5 font-serif text-body-lg text-ink-10 placeholder:text-ink-7"
                />
              </div>
              <div>
                <div className="flex items-baseline justify-between">
                  <label htmlFor="composer-body" className="block text-body-sm text-ink-9">Body</label>
                  <span className="font-mono text-caption tabular-nums text-ink-7">{body.length}/100000</span>
                </div>
                <textarea
                  id="composer-body"
                  name="body"
                  rows={10}
                  maxLength={100000}
                  value={body}
                  onChange={e => setBody(e.target.value)}
                  placeholder="Write the post"
                  className="mt-1 w-full resize-y rounded-md border border-ink-5 bg-ink-2 px-3 py-2.5 font-serif text-[19px] leading-[1.65] text-ink-10 placeholder:text-ink-7"
                />
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="flex flex-col gap-3" role="radiogroup" aria-label="Access">
              {([
                { key: 'free', label: 'Free', desc: 'Anyone can read it, signed out or in.' },
                { key: 'locked', label: 'Locked', desc: 'A reader pays once to unlock it.' },
                { key: 'subscribers', label: 'Subscribers only', desc: 'Only your subscribers can read it.' },
              ] as { key: Access; label: string; desc: string }[]).map(o => (
                <label
                  key={o.key}
                  className={`flex cursor-pointer items-start gap-3 rounded-md border p-4 ${
                    access === o.key ? 'border-mint bg-mint/5' : 'border-ink-4 bg-ink-1 hover:border-ink-5'
                  }`}
                >
                  <input
                    type="radio"
                    name="access"
                    value={o.key}
                    checked={access === o.key}
                    onChange={() => setAccess(o.key)}
                    className="mt-0.5 h-4 w-4 accent-mint"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-body-sm font-medium text-ink-10">{o.label}</span>
                    <span className="block text-caption text-ink-8">{o.desc}</span>
                  </span>
                </label>
              ))}

              {access === 'locked' && (
                <div className="mt-2">
                  <label htmlFor="composer-price" className="block text-body-sm text-ink-9">Price, in SUI</label>
                  <input
                    id="composer-price"
                    name="price"
                    type="number"
                    min={0.05}
                    step={0.05}
                    value={price}
                    onChange={e => setPrice(Number(e.target.value))}
                    className="mt-1 w-32 rounded-md border border-ink-5 bg-ink-2 px-3 py-2 font-mono text-body text-ink-10 tabular-nums"
                  />
                </div>
              )}
            </div>
          )}

          {step === 3 && (
            <div className="rounded-lg border border-ink-4 bg-ink-1 p-6">
              <h2 className="clamp-2 font-serif text-h4 font-medium leading-snug text-ink-10">
                {title || 'Untitled'}
              </h2>
              <div className="mt-3 flex items-center gap-2">
                {access === 'free' && <span className="rounded-full border border-ink-5 bg-ink-2 px-2.5 py-1 text-caption text-ink-9">Free</span>}
                {access === 'locked' && <span className="rounded-full border-2 border-mint/60 bg-mint/10 px-2.5 py-1 text-caption font-semibold text-mint">Locked — {fmtSui(price)} SUI</span>}
                {access === 'subscribers' && <span className="rounded-full border border-ink-6 bg-ink-3 px-2.5 py-1 text-caption text-ink-9">Subscribers only</span>}
              </div>
              <p className="mt-4 text-body-sm text-ink-8">
                Publishing signs this post with your key. It is permanent and cannot be silently
                edited.
              </p>
            </div>
          )}
        </div>

        <div className="mt-8 flex items-center justify-between">
          <button
            type="button"
            onClick={() => setStep(s => (s === 1 ? 1 : (s - 1) as Step))}
            disabled={step === 1}
            className="inline-flex min-h-[44px] items-center rounded-md border border-ink-5 px-4 py-2 text-body-sm text-ink-9 disabled:opacity-40 whitespace-nowrap cursor-pointer"
          >
            Back
          </button>
          {step < 3 ? (
            <button
              type="button"
              onClick={() => setStep(s => (s + 1) as Step)}
              className="inline-flex min-h-[44px] items-center rounded-md bg-mint px-5 py-2 text-body-sm font-semibold text-ink-0 hover:bg-mint-dim whitespace-nowrap cursor-pointer"
            >
              Next
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setPublished(true)}
              className="inline-flex min-h-[44px] items-center rounded-md border-2 border-rose bg-rose px-5 py-2 text-body-sm font-semibold text-ink-0 whitespace-nowrap cursor-pointer"
            >
              Publish
            </button>
          )}
        </div>
      </div>
    </Shell>
  );
}