'use client';
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useSigner } from '@/components/SignerProvider';

export function SessionBridge() {
  const pathname = usePathname();
  const router = useRouter();
  const { signer } = useSigner();

  useEffect(() => {
    const address = signer?.address;
    if (address === undefined) return;

    const params = new URLSearchParams(window.location.search);
    const reader = params.get('reader');
    if (reader !== null && reader.toLowerCase() === address.toLowerCase()) return;

    params.set('reader', address);
    router.replace(`${pathname}?${params.toString()}`);
  }, [signer?.address, pathname, router]);

  return null;
}
