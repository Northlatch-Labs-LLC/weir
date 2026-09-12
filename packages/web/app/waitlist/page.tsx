// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import type { Metadata } from 'next';
import { WaitlistScreen } from '@/components/app/WaitlistScreen';
import { readSiteMode } from '@/lib/site-mode';
import { waitlistTotal } from '@/lib/waitlist-store';
import { funnelSides } from '@/lib/explore-funnel-data';

export const metadata: Metadata = {
  title: 'Join the list',
  description:
    'Weir is a creator network on Sui. Leave an email and we will tell you when something ships — ' +
    'one email, no newsletter.',
};

export const dynamic = 'force-dynamic';

export default async function WaitlistPage() {
  const [{ waitlistMode, launchTarget }, total, funnel] = await Promise.all([
    readSiteMode(),
    waitlistTotal(),
    funnelSides(),
  ]);
  return <WaitlistScreen gated={waitlistMode} total={total} launchTarget={launchTarget} funnel={funnel} />;
}
