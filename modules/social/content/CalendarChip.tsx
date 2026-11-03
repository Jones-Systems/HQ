import type { ButtonHTMLAttributes } from 'react';
import type { Draft } from '../core';
import { ChannelBadge, SocialIcon } from '../ui';
import { clockLabel, draftGridEvent, durationLabel } from './calendar-time';
import { dateLabel } from './model';

export type CalendarChipHandlers = Pick<ButtonHTMLAttributes<HTMLButtonElement>,
  'onClick' | 'onPointerDown' | 'onPointerMove' | 'onPointerUp' | 'onPointerCancel' | 'onDragStart' | 'onDragEnd'>;

export interface CalendarChipProps {
  readonly draft: Draft;
  readonly brandName: string;
  /** The grid's display zone, for the 12-hour label of a timed draft. */
  readonly zone: string;
  readonly disabled: boolean;
  /** This chip is being dragged: it dims in place while its lifted copy follows the pointer. */
  readonly dragging: boolean;
  /** A save of this draft has an unknown outcome; moves stay paused until the workspace is checked. */
  readonly unknown: boolean;
  readonly handlers: CalendarChipHandlers;
}

/** Plain-language time for a timed draft ("9:00 a.m. · 30 min"), or null for a date-only draft. */
export function chipTime(draft: Draft, zone: string): string | null {
  const slot = draft.planning_slot;
  const event = slot ? draftGridEvent(draft, zone) : null;
  return slot && event ? `${clockLabel(event.start)} · ${durationLabel(slot.duration_minutes)}` : null;
}

/**
 * A planned draft as a calendar chip: a channel colour bar, a readable title (two lines, full title on hover or
 * focus) and the channel badge. It is the keyboard target for the move dialog and the drag source for pointer and
 * native drags. Dragging it never saves by itself; only a drop on a day does, through the calendar's single save.
 */
export function CalendarChip({ draft, brandName, zone, disabled, dragging, unknown, handlers }: CalendarChipProps) {
  const time = chipTime(draft, zone);
  const slot = draft.planning_slot;
  const planned = draft.planned_date
    ? `Planned ${dateLabel(draft.planned_date)}${time && slot ? ` at ${clockLabel(draftGridEvent(draft, zone)!.start)}, ${durationLabel(slot.duration_minutes)}` : ''}`
    : 'No date yet';
  return (
    <li className="cal-chip-item">
      <button
        type="button" className="cal-chip" data-channel={draft.channel} data-chip-id={draft.id}
        data-dragging={dragging || undefined} data-unknown={unknown || undefined}
        disabled={disabled} draggable={!disabled} title={draft.title}
        aria-label={`${draft.title}, ${draft.channel}, ${brandName}. ${planned}.${unknown ? ' The result of its last save is unknown; moves are paused.' : ''} Move or open`}
        {...handlers}
      >
        <span className="cal-chip-bar" aria-hidden="true" />
        <span className="cal-chip-title">{draft.title}</span>
        {time && slot && <span className="cal-chip-time">{clockLabel(draftGridEvent(draft, zone)!.start)}<span className="cal-chip-length"> · {durationLabel(slot.duration_minutes)}</span></span>}
        <span className="cal-chip-end">
          {unknown && <SocialIcon name="alert" className="cal-chip-flag" />}
          <ChannelBadge channel={draft.channel} />
        </span>
      </button>
    </li>
  );
}
