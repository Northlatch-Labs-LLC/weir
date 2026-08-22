// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
import type { Metadata } from 'next';
import { DesignWaitlist } from '@/components/design/Waitlist';
import { readSiteMode } from '@/lib/site-mode';
import { waitlistTotal } from '@/lib/waitlist-store';

export const metadata: Metadata = {
  title: 'Join the waiting list',
  description:
    'Weir is a creator network on Sui. Leave an email and we will tell you when something ships — ' +
    'one email, no newsletter.',
};

export const dynamic = 'force-dynamic';

export default async function WaitlistPage() {
  /*
    Both reads are independent, so neither waits on the other.

    `waitlistTotal` answers `null` rather than throwing or zeroing when the list cannot be read, so a
    database that is down costs this page its counter and nothing else. The form posts to a route
    that reports its own outcome and has to stay usable when the count could not be taken.
  */
  const [{ waitlistMode, launchTarget }, total] = await Promise.all([
    readSiteMode(),
    waitlistTotal(),
  ]);
  return <DesignWaitlist gated={waitlistMode} total={total} launchTarget={launchTarget} />;
}
