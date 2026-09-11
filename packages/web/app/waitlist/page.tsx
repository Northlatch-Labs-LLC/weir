// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import type { Metadata } from 'next';
import { DesignWaitlist } from '@/components/design/Waitlist';
import { readSiteMode } from '@/lib/site-mode';
import { waitlistTotal } from '@/lib/waitlist-store';
import { funnelSides } from '@/components/design/explore-funnel-data';

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
  return <DesignWaitlist gated={waitlistMode} total={total} launchTarget={launchTarget} funnel={funnel} />;
}
