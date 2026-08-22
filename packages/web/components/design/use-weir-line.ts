'use client';
// Built-by: @projectx.sui /|\ · Co-authored-by: Claude

import { useEffect, useRef, type RefObject } from 'react';

/**
 * `--crest-rgb` and `--line-rgb` are read from computed style rather than hardcoded, so the line
 * takes its colour from whichever theme is active.
 *
 * Under `prefers-reduced-motion` it draws exactly one frame at `t = 0` and never schedules another.
 * The line stays on screen; only the movement goes. Somebody who asked for less motion asked for
 * less motion, not for a missing element.
 */
export function useWeirLine(canvasRef: RefObject<HTMLCanvasElement | null>) {
  const gen = useRef(0);
  const raf = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;

    const cs = getComputedStyle(document.documentElement);
    const CR = (cs.getPropertyValue('--crest-rgb') || '').trim() || '139,227,198';
    const LR = (cs.getPropertyValue('--line-rgb') || '').trim() || '18,48,57';

    cancelAnimationFrame(raf.current);
    const mine = ++gen.current;

    const ctx = canvas.getContext('2d');
    if (ctx === null) return;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const dashes = Array.from({ length: 26 }, () => ({
      x: Math.random(),
      len: 14 + Math.random() * 34,
      lift: 6 + Math.random() * 46,
      speed: 0.00018 + Math.random() * 0.00042,
      alpha: 0.18 + Math.random() * 0.5,
    }));

    const frame = (now: number) => {
      if (
        mine !== gen.current ||
        !canvas.isConnected ||
        !canvas.clientWidth ||
        !canvas.clientHeight
      ) {
        return;
      }

      // Capped at 2: beyond that the extra pixels cost more than they show on a line this thin.
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const t = reduced ? 0 : now / 1000;
      const base = h * 0.62;
      // Three sines at unrelated periods: one is a wave, three never visibly repeat.
      const yAt = (x: number) =>
        base +
        Math.sin(x / 190 + t * 0.55) * 7 +
        Math.sin(x / 71 - t * 0.9) * 3.2 +
        Math.sin(x / 33 + t * 1.4) * 1.1;

      ctx.beginPath();
      ctx.moveTo(0, yAt(0));
      for (let x = 0; x <= w; x += 3) ctx.lineTo(x, yAt(x));
      ctx.lineTo(w, h);
      ctx.lineTo(0, h);
      ctx.closePath();
      const fill = ctx.createLinearGradient(0, base - 10, 0, h);
      fill.addColorStop(0, `rgba(${CR},0.16)`);
      fill.addColorStop(1, `rgba(${LR},0)`);
      ctx.fillStyle = fill;
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(0, yAt(0));
      for (let x = 0; x <= w; x += 3) ctx.lineTo(x, yAt(x));
      ctx.strokeStyle = `rgba(${CR},0.85)`;
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.lineCap = 'round';
      ctx.lineWidth = 3;
      for (const d of dashes) {
        if (!reduced) {
          d.x += d.speed;
          if (d.x > 1.2) d.x = -0.2;
        }
        const px = d.x * w;
        const py = yAt(px) - d.lift;
        ctx.strokeStyle = `rgba(${CR},${d.alpha * (1 - d.lift / 60) * 0.9})`;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px + d.len, py);
        ctx.stroke();
      }

      if (!reduced && mine === gen.current) raf.current = requestAnimationFrame(frame);
    };

    raf.current = requestAnimationFrame(frame);
    return () => {
      // Invalidate first, then cancel — a frame already queued checks the generation and returns.
      gen.current++;
      cancelAnimationFrame(raf.current);
    };
  }, [canvasRef]);
}

export function useReveals() {
  useEffect(() => {
    const seen = new WeakSet<Element>();
    const show = (el: Element) => {
      if (seen.has(el)) return;
      seen.add(el);
      el.setAttribute('data-revealed', '');
    };

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) if (entry.isIntersecting) show(entry.target);
      },
      { rootMargin: '0px 0px -40px 0px', threshold: 0.12 },
    );

    for (const node of Array.from(document.querySelectorAll('[data-reveal]'))) {
      if (node.getBoundingClientRect().top < window.innerHeight) show(node);
      else observer.observe(node);
    }
    return () => observer.disconnect();
  }, []);
}
