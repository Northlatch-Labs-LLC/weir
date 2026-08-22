// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
import type { Metadata } from 'next';
import { titleFor } from '@/lib/site-map';

/**
 * The title for the callback page, which cannot carry its own.
 *
 * `page.tsx` beside this is a client component — it reads the id token out of the URL fragment,
 * which only the browser can see — and a client component cannot export `metadata`. This layout
 * exists to hold the title and renders nothing of its own; the shell is still the root layout's.
 */
export const metadata: Metadata = { title: titleFor('/auth/callback') };

export default function AuthCallbackLayout({ children }: { children: React.ReactNode }) {
  return children;
}
