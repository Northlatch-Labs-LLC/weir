'use client';
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { useEffect } from 'react';
import { useReveals } from '@/components/design/use-weir-line';

export function Reveals() {
  useReveals();

  useEffect(() => {
    const settle = window.setTimeout(() => {
      for (const node of document.querySelectorAll('[data-reveal]:not([data-revealed])')) {
        node.setAttribute('data-revealed', '');
      }
    }, 1200);
    return () => window.clearTimeout(settle);
  }, []);

  return null;
}
