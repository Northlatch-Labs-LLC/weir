// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import { ImageResponse } from 'next/og';

/**
 * The icon iOS uses when somebody adds Weir to a home screen.
 *
 * 180px is the size Apple asks for, and it is large enough for the whole mark: the basin and the
 * three lines of water backing up behind it. `app/icon.tsx` drops the lines because 32px cannot
 * hold them; this one keeps them, which is the mark as it was drawn.
 *
 * No rounded corner here — iOS masks it itself, and a radius baked in shows as a double corner.
 */
export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

const GROUND = '#04161d';
const CREST = '#8be3c6';

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: GROUND,
        }}
      >
        <svg width="128" height="128" viewBox="0 0 24 24">
          <path d="M 0.356 9.1 A 12.0 12.0 0 1 0 23.644 9.1 Z" fill={CREST} />
          <line x1="5" y1="7.5" x2="19" y2="7.5" stroke={CREST} strokeWidth="1.8" strokeLinecap="round" />
          <line x1="7" y1="5" x2="17" y2="5" stroke={CREST} strokeWidth="1.8" strokeLinecap="round" />
          <line x1="9" y1="2.5" x2="15" y2="2.5" stroke={CREST} strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      </div>
    ),
    size,
  );
}
