import { formatCount } from './channel';

const RADIUS = 13;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/**
 * The length ring under the body: it fills as the text grows toward an illustrative limit and turns to a warning
 * past it. The words beside it carry the meaning (remaining or over), so the ring is decoration. The limit is a
 * writing guide, never a platform rule, and says so.
 */
export function LimitRing({ count, limit, channel, id }: { readonly count: number; readonly limit: number | null; readonly channel: string; readonly id?: string }) {
  if (limit === null) {
    return (
      <p className="soc-count" data-state="none" id={id}>
        <span className="soc-count-number">{formatCount(count)} characters</span>
        <span className="soc-count-note">No length guide for {channel}</span>
      </p>
    );
  }
  const fill = Math.min(1, count / limit);
  const over = count > limit;
  const near = !over && count / limit >= 0.9;
  const state = over ? 'over' : near ? 'near' : 'ok';
  return (
    <p className="soc-count" data-state={state} id={id}>
      <svg className="soc-ring" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
        <circle className="soc-ring-track" cx="16" cy="16" r={RADIUS} />
        <circle className="soc-ring-fill" cx="16" cy="16" r={RADIUS} strokeDasharray={CIRCUMFERENCE} style={{ strokeDashoffset: CIRCUMFERENCE * (1 - fill) }} />
      </svg>
      <span className="soc-count-number">{formatCount(count)} / {formatCount(limit)} characters</span>
      <span className="soc-count-note">
        {over ? `${formatCount(count - limit)} over` : `${formatCount(limit - count)} left`} · illustrative limit for {channel}, not a platform rule
      </span>
    </p>
  );
}
