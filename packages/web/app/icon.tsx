// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import { ImageResponse } from 'next/og';

/**
 * The browser-tab icon.
 *
 * `public/brand/favicon.svg` has existed since the brand was drawn and was referenced by nothing —
 * no `<link rel="icon">`, no `app/icon`, no metadata entry. The tab therefore showed whatever the
 * browser falls back to.
 *
 * Generated rather than served as that file because Next's file convention wants a raster for the
 * sizes that matter, and because the two must not drift: the geometry below is the same basin as
 * `WeirMark`, and the colours are the on-deep pair, which are the only ones a browser chrome can be
 * relied on to sit behind.
 */
export const size = { width: 32, height: 32 };
export const contentType = 'image/png';

/* The deep ground and the crest, from the brand's own on-deep variant. */
const GROUND = '#04161d';
const CREST = '#8be3c6';

export default function Icon() {
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
          borderRadius: 7,
        }}
      >
        {/*
          Only the basin at this size. The three water lines above it are 1.8 units on a 24 grid —
          at 32px they land under a pixel and turn to grey mush, which reads as a smudge rather than
          as a mark. `favicon.svg` drops them for the same reason.
        */}
        <svg width="26" height="26" viewBox="0 0 24 24">
          <path d="M 0.356 9.1 A 12.0 12.0 0 1 0 23.644 9.1 Z" fill={CREST} />
        </svg>
      </div>
    ),
    size,
  );
}
