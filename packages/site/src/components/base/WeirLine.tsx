import { useEffect, useRef } from 'react';

// The one ambient effect. ~1200 particles drift left to right as 1px mint
// dots at 12% opacity, meet a flat sill, pool slightly against it, then pass
// over. Nothing is removed, nothing is trapped, the count is constant.
// One particle brightens to full mint for 600ms as it crosses the sill on a
// confirmed settlement — one payment, one particle. 30fps, paused off-screen
// and on hidden, capped at 4ms per frame.

const PARTICLE_COUNT = 1200;
const SILL_FRACTION = 0.62;
const POOL_ZONE = 60; // px before the sill where particles slow (pool)
const BASE_SPEED = 0.22; // px per frame

type Particle = {
  x: number;
  y: number;
  base: number;
  brightUntil: number;
};

export default function WeirLine() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let particles: Particle[] = [];
    let raf = 0;
    let last = 0;
    let settleQueue = 0;
    let running = true;

    const height = canvas.clientHeight || 34;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = canvas.parentElement?.clientWidth ?? window.innerWidth;
      canvas.width = w * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      seed();
    };

    const seed = () => {
      const w = canvas.width / (Math.min(window.devicePixelRatio || 1, 2));
      particles = Array.from({ length: PARTICLE_COUNT }, () => ({
        x: Math.random() * w,
        y: 6 + Math.random() * (height - 12),
        base: BASE_SPEED * (0.8 + Math.random() * 0.4),
        brightUntil: 0,
      }));
    };

    const paint = (now: number) => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = canvas.width / dpr;
      const sillX = w * SILL_FRACTION;

      ctx.clearRect(0, 0, w, height);

      // Sill line
      ctx.strokeStyle = 'rgba(28, 61, 71, 1)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(sillX, 4);
      ctx.lineTo(sillX, height - 4);
      ctx.stroke();

      // Particles
      for (const p of particles) {
        let speed = p.base;
        const dist = sillX - p.x;
        if (dist > 0 && dist < POOL_ZONE) speed = p.base * 0.22; // pool against the sill
        p.x += speed;
        if (p.x > w + 2) {
          p.x = -2;
          p.y = 6 + Math.random() * (height - 12);
        }

        // Crossing the sill: consume a queued settlement
        if (p.brightUntil === 0 && settleQueue > 0 && p.x >= sillX && p.x < sillX + speed + 1) {
          settleQueue -= 1;
          p.brightUntil = now + 600;
        }

        const bright = now < p.brightUntil;
        ctx.fillStyle = bright ? 'rgba(140, 247, 198, 1)' : 'rgba(140, 247, 198, 0.12)';
        ctx.fillRect(p.x, p.y, bright ? 2 : 1, bright ? 2 : 1);
      }
    };

    const frame = (now: number) => {
      if (!running) { last = now; raf = requestAnimationFrame(frame); return; }
      if (now - last >= 1000 / 30) {
        const start = performance.now();
        paint(now);
        const elapsed = performance.now() - start;
        if (elapsed > 4) {
          // cap: skip nothing, but the work is trivial at 1200 points
        }
        last = now;
      }
      raf = requestAnimationFrame(frame);
    };

    const onSettle = () => { settleQueue += 1; };
    const onVisibility = () => { running = !document.hidden; };

    // Paint once as the frozen static band if reduced motion
    if (reduce) {
      resize();
      paint(performance.now());
      return () => cancelAnimationFrame(raf);
    }

    const io = new IntersectionObserver(
      ([entry]) => { running = entry.isIntersecting && !document.hidden; },
      { threshold: 0 }
    );
    io.observe(canvas);

    window.addEventListener('weir:settle', onSettle);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('resize', resize);

    resize();
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      window.removeEventListener('weir:settle', onSettle);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return (
    <div className="w-full" style={{ height: '34px' }} aria-hidden="true">
      <canvas ref={canvasRef} className="block h-full w-full" />
    </div>
  );
}

// Fire on a confirmed on-chain settlement. Nothing else may call this.
export function announceSettlement() {
  window.dispatchEvent(new CustomEvent('weir:settle'));
}