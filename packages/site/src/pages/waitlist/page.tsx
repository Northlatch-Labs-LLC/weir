import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import Shell from '@/components/layout/Shell';
import { getSiteMode } from '@/lib/api';
import { useApi } from '@/hooks/useApi';
import Icon from '@/components/base/Icon';
import { Loading, ErrorState } from '@/components/base/StateView';

const WAITLIST_FORM_URL = 'https://readdy.ai/api/form/dafj9rbep053ijub1rb0';

type SubmitStatus = 'idle' | 'submitting' | 'success' | 'error';

export default function Waitlist() {
  const modeRes = useApi(getSiteMode);
  const [status, setStatus] = useState<SubmitStatus>('idle');
  const [formError, setFormError] = useState<string | null>(null);

  const mode = modeRes.data;
  const doorShut = mode?.mode === 'read-only';

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);

    const honeypot = String(data.get('website_alt') ?? '').trim();
    if (honeypot) {
      setStatus('success');
      form.reset();
      return;
    }

    setStatus('submitting');
    setFormError(null);

    const payload = new URLSearchParams();
    for (const [key, value] of data.entries()) {
      if (key === 'website_alt') continue;
      payload.append(key, String(value));
    }

    try {
      const response = await fetch(WAITLIST_FORM_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: payload.toString(),
      });
      const responseText = await response.text();
      let parsed: { code?: string; message?: string; meta?: { message?: string; detail?: string } } | null = null;
      try {
        parsed = JSON.parse(responseText);
      } catch {
        parsed = null;
      }
      const serverMessage = parsed?.meta?.message ?? parsed?.message ?? parsed?.meta?.detail ?? responseText;
      const isSpam =
        typeof serverMessage === 'string' &&
        (serverMessage.includes('spam') || serverMessage.includes('form data is spam'));
      const succeeded = response.ok && parsed?.code === 'OK' && !isSpam;

      if (succeeded) {
        setStatus('success');
        form.reset();
      } else {
        setStatus('error');
        setFormError(
          typeof serverMessage === 'string' && serverMessage
            ? serverMessage
            : 'The email could not be submitted. Try again.',
        );
      }
    } catch {
      setStatus('error');
      setFormError('The email could not be submitted. Check your connection and try again.');
    }
  };

  return (
    <Shell>
      <div className="mx-auto max-w-3xl px-4 pt-10 md:px-6">
        <header>
          <h1 className="font-serif text-h1 font-medium leading-[1.1] text-ink-10">
            {doorShut ? 'Early access.' : 'weir is open.'}
          </h1>
          <p className="prose-body mt-5 text-ink-9">
            {doorShut
              ? 'The door is closed right now. Leave your email and you will hear when it opens.'
              : 'Leave your email and we will write when something worth reading lands.'}
          </p>
        </header>

        <div className="mt-6">
          {modeRes.status === 'loading' ? (
            <Loading lines={1} />
          ) : modeRes.status === 'error' ? (
            <ErrorState
              cause={modeRes.error?.message ?? 'The state of the door could not be read.'}
              moneyState="Nothing was read."
              next="Try again."
              retry={modeRes.reload}
            />
          ) : (
            <p className="inline-flex items-center gap-2 rounded-full border border-ink-5 bg-ink-1 px-3 py-1.5 text-caption text-ink-8">
              <span
                aria-hidden
                className={`h-2 w-2 rounded-full ${doorShut ? 'bg-rose' : 'bg-mint'}`}
              />
              {doorShut ? 'The door is closed' : 'The door is open'}
            </p>
          )}
        </div>

        <section className="mt-8">
          {status === 'success' ? (
            <div className="rounded-lg border border-ink-4 bg-ink-1 p-6" role="status">
              <div className="flex items-center gap-2 text-mint">
                <Icon name="check" size={16} />
                <span className="text-body font-medium">You are on the list.</span>
              </div>
              <p className="mt-2 text-body-sm text-ink-8">
                We will write to you when there is something to say.
              </p>
            </div>
          ) : (
            <form
              onSubmit={onSubmit}
              noValidate
              data-readdy-form
              className="rounded-lg border border-ink-4 bg-ink-1 p-6"
            >
              <label htmlFor="waitlist-email" className="block text-body-sm text-ink-9">
                Email
              </label>
              <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                <input
                  id="waitlist-email"
                  name="email"
                  type="email"
                  required
                  autoComplete="email"
                  aria-invalid={status === 'error' ? true : undefined}
                  aria-describedby={status === 'error' ? 'waitlist-error' : undefined}
                  placeholder="you@example.com"
                  className="flex-1 rounded-md border border-ink-5 bg-ink-2 px-3 py-2 text-body text-ink-10 placeholder:text-ink-7"
                />
                <button
                  type="submit"
                  disabled={status === 'submitting'}
                  className="inline-flex min-h-[44px] shrink-0 items-center gap-2 rounded-md bg-mint px-5 py-2 text-body-sm font-semibold text-ink-0 hover:bg-mint-dim disabled:opacity-60 whitespace-nowrap cursor-pointer"
                >
                  {status === 'submitting' ? 'Submitting…' : 'Join the waitlist'}
                </button>
              </div>

              <input
                type="text"
                name="website_alt"
                tabIndex={-1}
                autoComplete="off"
                aria-hidden="true"
                readOnly
                className="hp-field"
              />

              {status === 'error' && (
                <p id="waitlist-error" className="mt-3 text-body-sm text-rose" role="alert">
                  {formError}
                </p>
              )}
            </form>
          )}
        </section>

        <p className="mt-6 text-body-sm text-ink-8">
          {doorShut ? (
            <>
              <Link to="/" className="text-mint hover:underline">
                Read the home page
              </Link>{' '}
              while you wait.
            </>
          ) : (
            <>
              <Link to="/feed" className="text-mint hover:underline">
                Go to the feed
              </Link>
              .
            </>
          )}
        </p>
      </div>
    </Shell>
  );
}