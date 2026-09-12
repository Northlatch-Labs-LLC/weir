'use client';
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { useEffect } from 'react';

/*
  Marks [data-reveal] nodes revealed once they enter the viewport. Nodes already on screen at mount
  are marked at once, so the first frame is legible; the rest wait for the observer.
*/
export function useReveals() {
  useEffect(() => {
    const seen = new WeakSet<Element>();
    const show = (el: Element) => {
      if (seen.has(el)) return;
      seen.add(el);
      el.setAttribute('data-revealed', '');
    };

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) if (entry.isIntersecting) show(entry.target);
      },
      { rootMargin: '0px 0px -40px 0px', threshold: 0.12 },
    );

    for (const node of Array.from(document.querySelectorAll('[data-reveal]'))) {
      if (node.getBoundingClientRect().top < window.innerHeight) show(node);
      else observer.observe(node);
    }
    return () => observer.disconnect();
  }, []);
}
