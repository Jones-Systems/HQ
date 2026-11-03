import { type ReactNode } from 'react';
import type { DraftFields } from '../../core';
import { codePoints } from '../../core';
import { ChannelBadge } from '../../ui';
import { dateLabel } from '../model';
import { ILLUSTRATIVE_LIMITS, formatCount, showsHeadline, splitAtLimit } from './channel';

const TOKEN = /(#[\p{L}\p{N}_]+|@[\p{L}\p{N}_.]+|https?:\/\/[^\s]+)/gu;

/** Wraps hashtags, mentions and links so the card reads like a post. Plain text stays plain text. */
function tokens(text: string): ReactNode[] {
  return text.split(TOKEN).map((part, index) => (index % 2 === 1 ? <span key={index} className="soc-post-token">{part}</span> : part));
}

export function brandInitials(name: string): string {
  const words = name.trim().split(/\s+/u).filter(Boolean);
  const letters = words.length > 1 ? [words[0]!, words[1]!].map((word) => Array.from(word)[0]!) : Array.from(words[0] ?? '?').slice(0, 2);
  return letters.join('').toUpperCase();
}

/**
 * A post card for the selected channel that follows the text as it is typed. It is rendered from the editor's own
 * fields, so it updates in place with no state of its own. Text past the illustrative limit is marked, not cut.
 * It is an illustration of how the words may read: nothing is posted, and the platform's own rules are not applied.
 */
export function ChannelPreview({ fields, brandName }: { readonly fields: Pick<DraftFields, 'title' | 'body' | 'channel' | 'planned_date'>; readonly brandName: string }) {
  const limit = ILLUSTRATIVE_LIMITS[fields.channel];
  const { within, over } = splitAtLimit(fields.body, limit);
  const headline = showsHeadline(fields.channel);
  const empty = fields.body.trim() === '' && !(headline && fields.title.trim() !== '');
  return (
    <figure className="soc-preview" data-channel={fields.channel}>
      <figcaption className="soc-preview-head">
        <ChannelBadge channel={fields.channel} label />
        <span className="soc-preview-kind">Preview</span>
        <span className="sx-tag">Not posted</span>
      </figcaption>
      {/* The card repeats the text above it; the ring and checks carry the same facts in words. */}
      <div className="soc-post" aria-hidden="true">
        <div className="soc-post-head">
          <span className="soc-avatar">{brandInitials(brandName)}</span>
          <span className="soc-post-who">
            <span className="soc-post-name">{brandName}</span>
            <span className="soc-post-sub">{fields.planned_date ? `Planned ${dateLabel(fields.planned_date)}` : 'No planned date'}</span>
          </span>
        </div>
        {headline && fields.title.trim() !== '' && <p className="soc-post-title">{fields.title}</p>}
        {empty
          ? <p className="soc-post-empty">Your post appears here as you write.</p>
          : fields.body !== '' && (
            <p className="soc-post-body">
              {tokens(within)}
              {over && <mark className="soc-post-over">{tokens(over)}</mark>}
            </p>
          )}
        {limit !== null && over && <p className="soc-post-flag">{formatCount(codePoints(fields.body) - limit)} characters past the illustrative {formatCount(limit)}</p>}
      </div>
      <p className="soc-preview-foot">An illustration of how the text may read on {fields.channel}. Nothing is posted.</p>
    </figure>
  );
}
