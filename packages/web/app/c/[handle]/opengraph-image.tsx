// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import { ImageResponse } from 'next/og';
import { findProfile, countFollowers } from '@/lib/content';
import { readBlob } from '@/lib/walrus';
import { detectType } from '@/lib/media';
import { AVATAR_TYPES } from '@/lib/avatar';

export const alt = 'A creator on Weir';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

/*
  The card a share link shows: the page's picture when it has one, its name, its handle, its
  bio, and what the store counts. The picture is read from Walrus on the server and inlined, so
  the card needs nothing from the browser; a page without one shows the letters of its handle.
*/
async function inlinedPicture(blobId: string | null): Promise<string | null> {
  if (blobId === null) return null;
  const blob = await readBlob(blobId);
  if (!blob.ok) return null;
  const type = detectType(blob.value);
  if (type === null || !AVATAR_TYPES.has(type)) return null;
  return `data:${type};base64,${Buffer.from(blob.value).toString('base64')}`;
}

export default async function CreatorCard({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  const profile = await findProfile(handle);
  const followers = profile === null ? null : await countFollowers(profile.handle);
  const picture = profile === null ? null : await inlinedPicture(profile.imageBlobId);
  const name = profile?.displayName ?? handle;
  const bio = profile?.bio ?? '';

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: 72,
          background: '#051a21',
          backgroundImage:
            'radial-gradient(ellipse 80% 70% at 50% 115%, rgba(20,84,88,0.55), transparent 70%),' +
            'radial-gradient(ellipse 60% 50% at 88% 0%, rgba(28,60,66,0.6), transparent 70%)',
          color: '#e8f1f2',
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 36 }}>
          {picture === null ? (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 160,
                height: 160,
                borderRadius: 999,
                background: '#0d1c22',
                border: '2px solid rgba(139,227,196,0.35)',
                color: '#8be3c4',
                fontSize: 64,
                fontWeight: 700,
              }}
            >
              {handle.slice(0, 2).toUpperCase()}
            </div>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={picture}
              width={160}
              height={160}
              alt=""
              style={{ width: 160, height: 160, borderRadius: 999, objectFit: 'cover', border: '2px solid rgba(139,227,196,0.35)' }}
            />
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', fontSize: 64, fontWeight: 700, letterSpacing: -2 }}>{name}</div>
            <div style={{ display: 'flex', fontSize: 30, color: '#8be3c4' }}>@{handle}</div>
            {followers === null ? null : (
              <div style={{ display: 'flex', fontSize: 24, color: '#7d979e' }}>
                {followers} follower{followers === 1 ? '' : 's'}
              </div>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {bio === '' ? null : (
            <div style={{ display: 'flex', fontSize: 30, lineHeight: 1.4, color: '#c9d6d9', maxWidth: 1000 }}>
              {bio.length > 140 ? `${bio.slice(0, 139)}…` : bio}
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 22, letterSpacing: 4, color: '#8be3c4' }}>
            <span>WEIR</span>
            <span style={{ color: '#7d979e', letterSpacing: 0 }}>·</span>
            <span style={{ color: '#7d979e' }}>ON SUI</span>
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
