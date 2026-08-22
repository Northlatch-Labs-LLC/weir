// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
/**
 * The account tabs, for members only.
 *
 * The strip lists Messages, Alerts, Purchases, My vault and Referrals — a person's own things. A
 * guest on one of those pages gets the page's own locked state and no strip, for the same reason
 * the shell withholds the rail: member chrome on an unproven session is chrome that lies about
 * who you are. Proved by `provenReader()`, which is cached per request, so this costs nothing the
 * shell has not already paid.
 */
import { fold } from '@projectx-social/sdk';
import { PageTabs } from '@/components/shell/PageTabs';
import { provenReader } from '@/lib/read-session';
import { ACCOUNT_TABS } from '@/lib/site-map';

export async function AccountTabs() {
  const viewer = fold(
    await provenReader(),
    (value) => value,
    () => null,
  );
  if (viewer === null) return null;
  return <PageTabs label="Your account" items={ACCOUNT_TABS} />;
}
