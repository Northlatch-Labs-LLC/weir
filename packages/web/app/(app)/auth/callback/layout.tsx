// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { titleFor } from '@/lib/site-map';

/* The page is a client component (it reads the id token from the URL fragment), so its metadata lives here. */
export const metadata: Metadata = {
  title: titleFor('/auth/callback'),
  description: 'Finishing your Google sign-in.',
  robots: { index: false },
};

export default function AuthCallbackLayout({ children }: { children: ReactNode }) {
  return children;
}
