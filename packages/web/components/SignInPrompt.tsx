'use client';
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { Wall } from '@/components/app/Wall';

export function SignInPrompt({ action }: { action: string }) {
  return <Wall why={`Create an account or sign in to ${action}.`} compact />;
}
