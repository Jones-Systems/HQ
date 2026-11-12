/**
 * Shared Social UI (lane F3): the page header with its sync pill, the domain frame context, channel badges, icons,
 * a compact empty state and a cross-container FLIP helper. Motion, toasts, inline notices, status indicators and
 * skeletons come from `@hq/ui` (lane F1; docs/design/hq-visual-system/motion-and-feedback.md). Layout primitives
 * (`sx-panel`, `sx-list`, `sx-table`, `sx-tiles`, `sx-stepper`…) live in `social-ui.css`.
 */
import './social-ui.css';

export { ChannelBadge, CHANNEL_MARKS } from './ChannelBadge';
export { EmptyState } from './EmptyState';
export {
  longTime, PageHeader, shortTime, SocialFrameContext, syncState, SyncPill, useSocialFrame,
  type PageHeaderProps, type SocialFrame, type SyncTone,
} from './frame';
export { SocialIcon, type SocialIconName } from './icons';
export { flipFrom } from './motion';
