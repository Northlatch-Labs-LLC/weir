import type { ReactNode } from 'react';
import Header from './Header';
import BottomNav from './BottomNav';
import Footer from './Footer';
import WeirLine from '@/components/base/WeirLine';
import ScrollRestoration from '@/components/base/ScrollRestoration';
import RouteEffects from '@/components/base/RouteEffects';

export default function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-ink-0 text-ink-10">
      <a href="#main" className="skip-link">Skip to content</a>
      <ScrollRestoration />
      <RouteEffects />
      <Header />
      <WeirLine />
      <main id="main" className="flex-1 pb-24 md:pb-0">{children}</main>
      <Footer />
      <BottomNav />
    </div>
  );
}