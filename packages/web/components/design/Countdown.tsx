'use client';
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { useEffect, useState } from 'react';

const CREST = 'var(--crest,#8be3c6)';
const SAND = 'var(--sand,#d9c9a3)';
const DIM = 'var(--dim,#a3bcb8)';
const LINE = 'rgba(var(--crest-rgb,139,227,198),0.18)';

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
    <div style={{ textAlign: 'center', minWidth: '3.5rem' }}>
      <div
        style={{
          fontFamily: 'var(--weir-mono)',
          fontSize: 'clamp(1.5rem,1rem + 1.6vw,2.25rem)',
          fontWeight: 600,
          lineHeight: 1,
          color: CREST,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {String(value).padStart(2, '0')}
      </div>
      <div
        style={{
          marginTop: '0.4rem',
          fontFamily: 'var(--weir-mono)',
          fontSize: '0.75rem',
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: DIM,
        }}
      >
        {unit}
      </div>
    </div>
  );
}

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
    <section
      aria-label={label}
      style={{
        border: `1px solid ${LINE}`,
        borderLeft: `3px solid ${SAND}`,
        borderRadius: '10px',
        padding: '1.5rem',
        display: 'grid',
        gap: '1rem',
        justifyItems: 'center',
        textAlign: 'center',
      }}
    >
      <p
        style={{
          margin: 0,
          fontFamily: 'var(--weir-mono)',
          fontSize: '0.8125rem',
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: SAND,
        }}
      >
        {label}
      </p>

      {/*
        The figures are `aria-hidden` and the sentence beneath is not. A live region that changes
        every second interrupts a screen reader continuously and makes the rest of the page
        unreadable; the date, said once, carries the same information.
      */}
      {remaining !== null && (
        <div
          aria-hidden="true"
          style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', justifyContent: 'center' }}
        >
          <Cell value={remaining.days} unit="days" />
          <Cell value={remaining.hours} unit="hrs" />
          <Cell value={remaining.minutes} unit="min" />
          <Cell value={remaining.seconds} unit="sec" />
        </div>
      )}

      {passed ? (
        <p style={{ margin: 0, color: 'var(--ink,#dce9e6)', fontSize: '0.9375rem', textWrap: 'pretty' }}>
          That date has arrived: {date}.
        </p>
      ) : (
        <p style={{ margin: 0, color: DIM, fontSize: '0.9375rem', textWrap: 'pretty' }}>
          {date}{' '}
          <span style={{ fontFamily: 'var(--weir-mono)', fontSize: '0.8125rem' }}>UTC</span>
        </p>
      )}

      {/*
        The sentence that stops a clock on a live product from reading as "launch". It is not
        decoration and it is not optional — see the header, and `db/016_waitlist_growth.sql`.
      */}
      <p
        style={{
          margin: 0,
          fontFamily: 'var(--weir-mono)',
          fontSize: '0.8125rem',
          color: DIM,
          textWrap: 'pretty',
          maxWidth: '46ch',
        }}
      >
        {gated
          ? 'This is the date we plan to open on, not a commitment we have made. Until then, access is by invitation.'
          : 'Weir is already open; this is the next milestone we plan for.'}
      </p>
    </section>
  );
}
