// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import type { Metadata } from 'next';
import { titleFor } from '@/lib/site-map';

export const metadata: Metadata = { title: titleFor('/auth/callback') };

export default function AuthCallbackLayout({ children }: { children: React.ReactNode }) {
  return children;
}
