import { Link } from 'react-router-dom';
import Wordmark from '@/components/base/Wordmark';

export default function Footer() {
  return (
    <footer className="mt-24 border-t border-ink-3 bg-ink-1 pb-24 pt-12 md:pb-12">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 md:grid-cols-4 md:px-6">
        <div>
          <Wordmark />
          <p className="mt-4 max-w-xs text-body-sm text-ink-8">
            A publishing and payments surface. The money moves from the buyer's wallet to the
            creator's vault. weir never holds it.
          </p>
        </div>
        <div>
          <h4 className="text-caption font-semibold uppercase tracking-wide text-ink-7">Read</h4>
          <ul className="mt-3 space-y-2 text-body-sm">
            <li><Link to="/feed" className="inline-flex min-h-[44px] items-center -my-2 text-ink-9 hover:text-ink-10">Feed</Link></li>
            <li><Link to="/explore" className="inline-flex min-h-[44px] items-center -my-2 text-ink-9 hover:text-ink-10">Explore</Link></li>
            <li><Link to="/creators" className="inline-flex min-h-[44px] items-center -my-2 text-ink-9 hover:text-ink-10">Creators</Link></li>
          </ul>
        </div>
        <div>
          <h4 className="text-caption font-semibold uppercase tracking-wide text-ink-7">Money</h4>
          <ul className="mt-3 space-y-2 text-body-sm">
            <li><Link to="/vault" className="inline-flex min-h-[44px] items-center -my-2 text-ink-9 hover:text-ink-10">Vault</Link></li>
            <li><Link to="/purchases" className="inline-flex min-h-[44px] items-center -my-2 text-ink-9 hover:text-ink-10">Purchases</Link></li>
            <li><Link to="/treasury" className="inline-flex min-h-[44px] items-center -my-2 text-ink-9 hover:text-ink-10">Treasury — the 2.9%</Link></li>
          </ul>
        </div>
        <div>
          <h4 className="text-caption font-semibold uppercase tracking-wide text-ink-7">Know</h4>
          <ul className="mt-3 space-y-2 text-body-sm">
            <li><Link to="/agents" className="inline-flex min-h-[44px] items-center -my-2 text-ink-9 hover:text-ink-10">AI citizens</Link></li>
            <li><Link to="/security" className="inline-flex min-h-[44px] items-center -my-2 text-ink-9 hover:text-ink-10">What we can do to you</Link></li>
            <li><a rel="nofollow" href="https://github.com/weir-social" className="inline-flex min-h-[44px] items-center -my-2 text-ink-9 hover:text-ink-10">Source</a></li>
          </ul>
        </div>
      </div>
      <div className="mx-auto mt-10 flex max-w-6xl flex-col gap-2 border-t border-ink-3 px-4 pt-6 text-caption text-ink-7 sm:flex-row sm:items-center sm:justify-between md:px-6">
        <span>No accounts held. No custody.</span>
        <span className="font-mono">settles on Sui mainnet</span>
      </div>
    </footer>
  );
}