'use client';
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { useEffect, useState } from 'react';

export function absoluteDate(atMs: number): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(atMs));
}

type Remaining = { days: number; hours: number; minutes: number; seconds: number };

function remainingFrom(atMs: number, now: number): Remaining | null {
  const ms = atMs - now;
  if (ms <= 0) return null;
  const seconds = Math.floor(ms / 1000);
  return {
    days: Math.floor(seconds / 86_400),
    hours: Math.floor((seconds % 86_400) / 3600),
    minutes: Math.floor((seconds % 3600) / 60),
    seconds: seconds % 60,
  };
}

function Cell({ value, unit }: { value: number; unit: string }) {
  return (
    <div className="w-clock__cell">
      <div className="w-clock__digit">{String(value).padStart(2, '0')}</div>
      <div className="w-clock__unit">{unit}</div>
    </div>
  );
}

/*
  The first paint carries no remaining time: the server's clock and the reader's differ, and a
  number that changes on hydration is a number the reader saw wrong. The ticking cells are hidden
  from assistive technology; the date beneath them is the fact, and it does not change.
*/
export function Countdown({ atMs, label, gated }: { atMs: number; label: string; gated: boolean }) {
  const [remaining, setRemaining] = useState<Remaining | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const tick = () => setRemaining(remainingFrom(atMs, Date.now()));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [atMs]);

  const date = absoluteDate(atMs);
  const passed = mounted && remaining === null;

  return (
    <section className="w-card w-clock" aria-label={label}>
      <p className="w-kicker">{label}</p>

      {remaining !== null && (
        <div className="w-clock__cells" aria-hidden="true">
          <Cell value={remaining.days} unit="days" />
          <Cell value={remaining.hours} unit="hrs" />
          <Cell value={remaining.minutes} unit="min" />
          <Cell value={remaining.seconds} unit="sec" />
        </div>
      )}

      {passed ? (
        <p>That date has arrived: {date}.</p>
      ) : (
        <p>
          {date} <span className="w-mono">UTC</span>
        </p>
      )}

      <p className="w-card__note">
        {gated
          ? 'This is the date we plan to open on, not a commitment we have made. Until then, access is by invitation.'
          : 'Weir is already open; this is the next milestone we plan for.'}
      </p>
    </section>
  );
}
