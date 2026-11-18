import type { Channel } from '../core';

/** Short marks for each channel. The full name is always available as the accessible label. */
export const CHANNEL_MARKS: { readonly [C in Channel]: string } = {
  General: 'GEN', X: 'X', LinkedIn: 'in', TikTok: 'TT', Instagram: 'IG', Facebook: 'FB', Reddit: 'RD', Article: 'ART',
};

/**
 * A compact channel mark (`X`, `in`, `IG`…) with its channel hue as a small dot. The hue is decoration for
 * scanning; the mark and the accessible name carry the meaning.
 */
export function ChannelBadge({ channel, label = false, className }: { readonly channel: Channel; readonly label?: boolean; readonly className?: string }) {
  return (
    <span className={className ? `sx-channel ${className}` : 'sx-channel'} data-channel={channel} title={channel}>
      <span className="sx-channel-dot" aria-hidden="true" />
      <span aria-hidden="true">{CHANNEL_MARKS[channel]}</span>
      <span className={label ? 'sx-channel-name' : 'hq-sr-only'}>{channel}</span>
    </span>
  );
}
