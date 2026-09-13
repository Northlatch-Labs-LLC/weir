// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

export const metadata: Metadata = { title: 'Names', description: 'Moved to /names.', robots: { index: false } };

export default function VerifiedRedirect() {
  redirect('/names');
}
