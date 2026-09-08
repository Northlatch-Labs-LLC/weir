import Icon from '@/components/base/Icon';

// Locked media is ciphertext the platform genuinely cannot render. No blurred
// image, no fake thumbnail. The slot is filled at its real aspect ratio with a
// centred lock and the honest line.
export default function LockedMedia({ count, ratio = 16 / 9 }: { count: number; ratio?: number }) {
  return (
    <div
      className="flex w-full flex-col items-center justify-center gap-3 border border-ink-3 bg-ink-2 text-center"
      style={{ aspectRatio: String(ratio) }}
      role="img"
      aria-label={`${count} encrypted image${count === 1 ? '' : 's'}, unlock after purchase`}
    >
      <span className="flex h-10 w-10 items-center justify-center rounded-full border border-ink-5 text-ink-8">
        <Icon name="lock" size={20} />
      </span>
      <p className="px-4 text-caption text-ink-8">
        Encrypted. {count} image{count === 1 ? '' : 's'} unlock after purchase.
      </p>
    </div>
  );
}