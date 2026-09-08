'use client';
// Built-by: @projectx.sui · Co-authored-by: Claude

/**
 * The clock, and the only thing on this site that is a claim about the future.
 *
 * # It renders nothing unless somebody set a date
 *
 * The date and its label come from `site_mode`, set by the site administrator. There is no default,
 * no fallback and no "launching soon" — a countdown with an invented target would be the single
 * fabricated number in a product whose whole argument is that its figures are read rather than
 * asserted. `null` renders `null`, at the call site.
 *
 * # Why the label is not optional
 *
 * A bare clock on a page is a promise whose content the reader supplies themselves, and they supply
 * "launch". Weir is already live — creators are posting, vaults are staking — so that is the one
 * meaning it must never carry. The label says what actually happens on the date, and the schema
 * enforces that the two travel together (`db/016_waitlist_growth.sql`).
 *
 * # Hydration
 *
 * The server renders at one instant and the browser hydrates at another, so a countdown computed in
 * both places disagrees with itself and React replaces the markup with a warning. The first paint is
 * therefore the *date*, which is the same string everywhere, and the ticking figures appear after
 * mount. Without JavaScript the date stays — which is the more useful half anyway.
 *
 * # It does not count past zero
 *
 * When the date arrives the clock is replaced by a sentence saying so. Negative time rendered as
 * "-3 days" is the classic tell of a page nobody looked at after its own deadline.
 */

import { useEffect, useState } from 'react';

const CREST = 'var(--crest,#8be3c6)';
const SAND = 'var(--sand,#d9c9a3)';
const DIM = 'var(--dim,#a3bcb8)';
const LINE = 'rgba(var(--crest-rgb,139,227,198),0.18)';

/**
 * The date as an unambiguous string.
 *
 * Exported since 2026-09-04: `/agents` and the waiting list's own agent line print the same date
 * from the same reading, and two formatters would eventually disagree about a month name or a time
 * zone on two pages describing one number.
 */
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
          // Digits that change every second must not shift the cells beside them.
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {String(value).padStart(2, '0')}
      </div>
      <div
        style={{
          marginTop: '0.4rem',
          fontFamily: 'var(--weir-mono)',
          fontSize: '0.6875rem',
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

/**
 * `gated` is required, like `label`, because the sentence under the clock is a statement about what
 * is open today and the two states of the door make opposite statements. Defaulting it would let a
 * closed site say the feed is open — the one claim this component exists to never make.
 */
export function Countdown({ atMs, label, gated }: { atMs: number; label: string; gated: boolean }) {
  /*
    `null` until mounted, which is also what the server renders. The two agree by construction rather
    than by the clocks happening to be close enough, and the date below is painted either way.
  */
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
        // Not a negative clock, and not silence either: the date is still the answer to "when".
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
