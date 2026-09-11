// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
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
