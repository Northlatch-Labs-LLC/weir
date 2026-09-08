import { useEffect } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';

// Restore scroll on back navigation; jump to the top on a new page. A search
// parameter change (REPLACE) keeps the reader where they are. Positions are
// keyed by location.key, so returning to a page puts it back under the thumb.
const positions = new Map<string, number>();

export default function ScrollRestoration() {
  const location = useLocation();
  const navType = useNavigationType();

  useEffect(() => {
    if ('scrollRestoration' in window.history) {
      window.history.scrollRestoration = 'manual';
    }
  }, []);

  useEffect(() => {
    if (navType === 'POP') {
      window.scrollTo(0, positions.get(location.key) ?? 0);
    } else if (navType === 'PUSH') {
      window.scrollTo(0, 0);
    }
    // REPLACE (filter change) leaves scroll untouched.
  }, [location.key, navType]);

  useEffect(() => {
    const onScroll = () => positions.set(location.key, window.scrollY);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [location.key]);

  return null;
}