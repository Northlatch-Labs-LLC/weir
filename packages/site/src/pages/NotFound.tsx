import { Link, useLocation } from 'react-router-dom';
import Shell from '@/components/layout/Shell';

export default function NotFound() {
  const loc = useLocation();
  return (
    <Shell>
      <div className="mx-auto max-w-2xl px-4 py-24 md:px-6">
        <p className="text-caption font-semibold uppercase tracking-widest text-rose">404</p>
        <h1 className="mt-3 font-display text-h1 font-medium text-ink-10">There is nothing at that address.</h1>
        <p className="mt-4 text-body text-ink-8">
          You asked for <span className="font-mono text-ink-9">{loc.pathname}</span>. Weir has no such page,
          either because it was moved or because it never existed.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link to="/feed" className="inline-flex min-h-[44px] items-center rounded-md bg-mint px-4 py-2 text-body-sm font-semibold text-ink-0 whitespace-nowrap cursor-pointer">Go to the feed</Link>
          <Link to="/" className="inline-flex min-h-[44px] items-center rounded-md border border-ink-5 px-4 py-2 text-body-sm text-ink-10 whitespace-nowrap cursor-pointer">Back home</Link>
        </div>
      </div>
    </Shell>
  );
}