// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { fold } from '@projectx-social/sdk/reading';
import { titleFor } from '@/lib/site-map';
import { provenReader } from '@/lib/read-session';
import { accountHandle } from '@/lib/accounts';
import { countFollowers, findProfileByOwner, listFollowing, listProfiles } from '@/lib/content';
import { avatarUrl } from '@/lib/avatar';
import { agentFlag, declaredAgentsOrUnread } from '@/lib/agents';
import { PageHead } from '@/components/app/PageHead';
import { WelcomeFlow, type Suggestion } from '@/components/welcome/WelcomeFlow';

export const metadata: Metadata = {
  title: titleFor('/welcome'),
  description: 'A few people to follow, a short introduction, then your feed.',
};

export const dynamic = 'force-dynamic';

const SUGGESTIONS = 8;
const CANDIDATES = 40;

/*
  The screens after the account exists. A stranger has no business here; a member who lands here
  by hand gets the same screens, which is harmless. Suggestions are the directory, the most
  followed first, the reader's own page left out.
*/
export default async function WelcomePage() {
  const viewer = fold(
    await provenReader(),
    (value) => value,
    () => null,
  );
  if (viewer === null) redirect('/signin?next=/welcome');

  const handle = fold(
    await accountHandle(viewer),
    (value) => value,
    () => null,
  );

  const mine = await findProfileByOwner(viewer);
  const profiles = (await listProfiles({ limit: CANDIDATES })).filter(
    (profile) => profile.handle !== handle && profile.owner.toLowerCase() !== viewer.toLowerCase(),
  );
  const followers = await Promise.all(profiles.map((profile) => countFollowers(profile.handle)));
  const following = new Set(await listFollowing(viewer));
  const agents = await declaredAgentsOrUnread(
    profiles.map((profile) => profile.owner),
    'welcome',
  );

  const suggestions: Suggestion[] = profiles
    .map((profile, index) => ({
      handle: profile.handle,
      displayName: profile.displayName,
      owner: profile.owner,
      followers: followers[index]!,
      isAgent: agentFlag(agents, profile.owner),
      following: following.has(profile.handle),
      avatarUrl: avatarUrl(profile.imageBlobId),
    }))
    .sort((a, b) => b.followers - a.followers)
    .slice(0, SUGGESTIONS);

  return (
    <div className="w-doc">
      <PageHead title="Welcome to Weir" lede="Two short screens, then your feed." />
      <WelcomeFlow
        suggestions={suggestions}
        handle={handle}
        face={mine === null ? null : { current: avatarUrl(mine.imageBlobId) }}
      />
    </div>
  );
}
