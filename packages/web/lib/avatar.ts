// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

/*
  A page's picture is a Walrus blob named on its profile row. The site serves it from its own
  address so the browser never talks to an aggregator, and the route serves only blobs some
  profile names. A profile without one keeps the mark drawn from its address.
*/
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;

export const AVATAR_TYPES: ReadonlySet<string> = new Set(['image/png', 'image/jpeg', 'image/webp']);

export function avatarUrl(imageBlobId: string | null | undefined): string | null {
  return imageBlobId === null || imageBlobId === undefined ? null : `/api/avatar/${imageBlobId}`;
}
