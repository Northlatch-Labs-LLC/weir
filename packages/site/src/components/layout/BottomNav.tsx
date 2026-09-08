import { NavLink } from 'react-router-dom';
import { useViewer } from '@/lib/viewer-context';
import Icon, { type IconName } from '@/components/base/Icon';

const items: { to: string; label: string; icon: IconName }[] = [
  { to: '/feed', label: 'Feed', icon: 'comments' },
  { to: '/explore', label: 'Explore', icon: 'search' },
  { to: '/creators', label: 'Creators', icon: 'creator' },
];

export default function BottomNav() {
  const { viewer } = useViewer();

  return (
    <nav
      aria-label="Bottom"
      className="fixed bottom-0 left-0 right-0 z-40 grid grid-cols-4 border-t border-ink-3 bg-ink-0/95 backdrop-blur md:hidden"
    >
      {items.map(it => (
        <NavLink
          key={it.to}
          to={it.to}
          className={({ isActive }) =>
            `flex min-h-[56px] flex-col items-center justify-center gap-1 py-2 text-caption ${
              isActive ? 'text-ink-10' : 'text-ink-8'
            }`
          }
        >
          <Icon name={it.icon} size={20} />
          {it.label}
        </NavLink>
      ))}

      {/* Fourth slot: permanent filled Join when signed out; Compose when signed in. */}
      {viewer.signedIn ? (
        <NavLink
          to="/studio"
          className="flex min-h-[56px] flex-col items-center justify-center gap-1 bg-mint py-2 text-caption font-semibold text-ink-0"
        >
          <Icon name="plus" size={20} />
          Compose
        </NavLink>
      ) : (
        <NavLink
          to="/join"
          className="flex min-h-[56px] flex-col items-center justify-center gap-1 bg-mint py-2 text-caption font-semibold text-ink-0"
        >
          <Icon name="plus" size={20} />
          Join
        </NavLink>
      )}
    </nav>
  );
}