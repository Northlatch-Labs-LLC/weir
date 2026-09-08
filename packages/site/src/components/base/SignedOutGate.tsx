import { Link } from 'react-router-dom';

// Shown on pages that require an account. An account is requested only at the
// first action that needs one — in place, stating what it unlocks.
export default function SignedOutGate({ what, next = 'vault' }: { what: string; next?: string }) {
  return (
    <div className="rounded-lg border border-ink-4 bg-ink-1 p-8">
      <h2 className="font-serif text-h4 font-medium text-ink-10">You are signed out.</h2>
      <p className="mt-3 text-body text-ink-8">
        {what} An account is a key on your device. No email is required.
      </p>
      <div className="mt-6 flex flex-wrap gap-2">
        <Link
          to="/signin"
          className="inline-flex min-h-[44px] items-center rounded-md bg-mint px-4 py-2 text-body-sm font-semibold text-ink-0 hover:bg-mint-dim whitespace-nowrap cursor-pointer"
        >
          Sign in
        </Link>
        <Link
          to="/join"
          className="inline-flex min-h-[44px] items-center rounded-md border border-ink-5 px-4 py-2 text-body-sm text-ink-10 hover:border-ink-6 whitespace-nowrap cursor-pointer"
        >
          Create account
        </Link>
      </div>
    </div>
  );
}