'use client';
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { useEffect, useRef } from 'react';

/**
 * The water line. The product's one piece of signature motion.
 *
 * A weir is a barrier water backs up behind, and this is that surface: a drifting wave with dashes
 * of light lifting off it. It is the only thing in the interface that moves on its own, which is
 * what makes it a signature rather than decoration.
 *
 * # Why it is here rather than where it was
 *
 * It was `packages/web/components/design/use-weir-line.ts`, a hook five components called, four of
 * which render on no route. It reached exactly one page — `/waitlist`. A signature that appears on
 * one screen out of thirty-seven is not a signature.
 *
 * # What changed on the way
 *
 * It stops when nobody is looking. The original ran its `requestAnimationFrame` loop for as long as
 * the component was mounted, including on a background tab and while scrolled past — a canvas
 * repainting sixty times a second behind a page nobody is reading, on a phone, on a battery. An
 * `IntersectionObserver` and `visibilitychange` park it, and it resumes where it left off.
 *
 * `prefers-reduced-motion` draws one static frame and never schedules another. Colours come from
 * `--crest-rgb` and `--line-rgb`, so it follows the theme rather than carrying its own.
 */
export function WeirLine({
  height = 120,
  className,
}: {
  /** The band's height in pixels. The wave sits at 62% of it. */
  height?: number;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const ctx = canvas.getContext('2d');
    if (ctx === null) return;

    const cs = getComputedStyle(document.documentElement);
    const CR = (cs.getPropertyValue('--crest-rgb') || '').trim() || '140,247,198';
    const LR = (cs.getPropertyValue('--line-rgb') || '').trim() || '89,99,124';

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const dashes = Array.from({ length: 26 }, () => ({
      x: Math.random(),
      len: 14 + Math.random() * 34,
      lift: 6 + Math.random() * 46,
      speed: 0.00018 + Math.random() * 0.00042,
      alpha: 0.18 + Math.random() * 0.5,
    }));

    let raf = 0;
    let onScreen = true;
    let stopped = false;

    const draw = (now: number) => {
      if (stopped || !canvas.isConnected || !canvas.clientWidth || !canvas.clientHeight) return;

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
      const yAt = (x: number) =>
        base
        + Math.sin(x / 190 + t * 0.55) * 7
        + Math.sin(x / 71 - t * 0.9) * 3.2
        + Math.sin(x / 33 + t * 1.4) * 1.1;

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

      if (!reduced && onScreen && !document.hidden) raf = requestAnimationFrame(draw);
    };

    const start = () => {
      if (stopped || reduced) return;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(draw);
    };

    /* One frame regardless, so a reduced-motion reader and a parked tab both see the surface. */
    raf = requestAnimationFrame(draw);

    const observer = new IntersectionObserver(
      (entries) => {
        onScreen = entries.some((entry) => entry.isIntersecting);
        if (onScreen) start();
        else cancelAnimationFrame(raf);
      },
      { threshold: 0 },
    );
    observer.observe(canvas);

    const onVisibility = () => {
      if (document.hidden) cancelAnimationFrame(raf);
      else if (onScreen) start();
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      observer.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className={className === undefined ? 'w-line' : `w-line ${className}`}
      style={{ height }}
      aria-hidden
    />
  );
}
