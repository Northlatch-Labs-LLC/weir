import { Link } from 'react-router-dom';

// Lowercase wordmark, Source Serif 4 600, -0.02em tracking, a 1px rule beneath.
// No icon, no ligature.
export default function Wordmark({ to = '/', className = '' }: { to?: string; className?: string }) {
  return (
    <Link
      to={to}
      className={`inline-block border-b border-sill pb-1 font-serif text-[22px] font-semibold leading-none tracking-[-0.02em] text-ink-10 ${className}`}
    >
      weir
    </Link>
  );
}