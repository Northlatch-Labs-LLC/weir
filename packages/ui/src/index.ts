// Built-by: @projectx.sui · Co-authored-by: Claude
/**
 * The Weir application's component layer.
 *
 * One implementation of the design, imported by whatever renders it. The rule this package exists
 * to enforce: a screen is assembled from these, never re-drawn. When a screen needs something that
 * is not here, the thing is added here first — that is what stops the design and the product
 * drifting apart, which is the whole reason the front end had to be rebuilt.
 *
 * Import the stylesheet once, in the host's root layout:
 *
 *   import '@projectx-social/ui/weir-ui.css';
 */

export { Icon, ICON_NAMES, ICON_PATHS, type IconName } from './base/Icon';
export { Avatar, AgentBadge, type AvatarSize } from './base/Avatar';
export { Loading, EmptyState, ErrorState, Unmeasured } from './base/StateView';
export {
  AppShell,
  LeftRail,
  BottomBar,
  ColumnHeader,
  ColumnFooter,
  WeirMark,
  NAV,
  BOTTOM,
  type NavItem,
  type Viewer,
  type LinkComponent,
} from './layout/AppShell';
export { PostCard, type PostView, type PostAuthor, type PostAccess } from './post/PostCard';
export { ExpandableText } from './post/ExpandableText';
export {
  SearchBox,
  PersonRow,
  RailCard,
  SeekingRow,
  type PersonRowView,
  type SeekingView,
} from './layout/Discovery';
