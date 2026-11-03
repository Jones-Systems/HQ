// Calendar-date helpers. Date-only values are handled as ISO day strings and
// whole UTC day numbers so they never shift with the viewer's time zone.
// The server is authoritative for validation; these helpers format, compare
// and place dates without inventing days for coarse precisions.

export const DATE_KINDS = ['target', 'deadline', 'start', 'event'];
export const KIND_LABEL = { target: 'Target', deadline: 'Deadline', start: 'Start', event: 'Event' };
export const KIND_HINT = {
  target: 'A soft aim. Passing it is not a failure.',
  deadline: 'A real consequence or commitment.',
  start: 'Planned start or not-before marker.',
  event: 'A fixed occurrence, such as an appointment.',
};
export const PRECISIONS = ['day', 'week', 'month', 'quarter', 'year'];
export const PRECISION_LABEL = { day: 'Day', week: 'Week', month: 'Month', quarter: 'Quarter', year: 'Year' };

const DAY_MS = 86400000;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEKDAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export const pad = (n, w = 2) => String(n).padStart(w, '0');

export function dayNum(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / DAY_MS);
}

export function isoFromNum(n) {
  return new Date(n * DAY_MS).toISOString().slice(0, 10);
}

export const addDays = (iso, n) => isoFromNum(dayNum(iso) + n);
export const weekday = (iso) => new Date(dayNum(iso) * DAY_MS).getUTCDay();

// ------------------------------------------------------- display clock
// "Now" and recorded instants (saves, drafts, backups) are shown in the owner's
// display zone (settings.default_tz, America/New_York unless changed), never the
// browser's own zone, and clock times always carry their abbreviation (EDT/EST).

export const DEFAULT_DISPLAY_ZONE = 'America/New_York';
const zoneFormatters = new Map();

function zoneFormatter(zone) {
  let fmt = zoneFormatters.get(zone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZoneName: 'short',
    });
    zoneFormatters.set(zone, fmt);
  }
  return fmt;
}

/** `zone` if this browser knows it, otherwise the default display zone. */
export function resolveZone(zone) {
  if (typeof zone === 'string' && zone) {
    try {
      zoneFormatter(zone);
      return zone;
    } catch { /* unknown zone: fall back */ }
  }
  return DEFAULT_DISPLAY_ZONE;
}

/** Wall-clock reading of an instant in `zone`: { iso, hour, minute, abbr }, or null. */
export function zonedParts(instant, zone = DEFAULT_DISPLAY_ZONE) {
  const at = instant instanceof Date ? instant : new Date(instant);
  if (Number.isNaN(at.getTime())) return null;
  const p = Object.fromEntries(zoneFormatter(resolveZone(zone)).formatToParts(at).map((x) => [x.type, x.value]));
  return {
    iso: `${p.year}-${p.month}-${p.day}`,
    hour: Number(p.hour) % 24,
    minute: Number(p.minute),
    abbr: p.timeZoneName || '',
  };
}

/** Today's ISO day in the display zone (not the browser's). */
export function todayISO(now = new Date(), zone = DEFAULT_DISPLAY_ZONE) {
  return zonedParts(now, zone).iso;
}

/** "6:36 PM EDT" — an instant's clock time in `zone`, with its abbreviation. */
export function formatClock(instant, zone = DEFAULT_DISPLAY_ZONE) {
  const p = zonedParts(instant, zone);
  if (!p) return '';
  const hour = p.hour % 12 === 0 ? 12 : p.hour % 12;
  return `${hour}:${pad(p.minute)} ${p.hour < 12 ? 'AM' : 'PM'}${p.abbr ? ` ${p.abbr}` : ''}`;
}

/** "Oct 9, 6:36 PM EDT" (or "Oct 9, 2026, 6:36 PM EDT" with `year`). */
export function formatStamp(instant, zone = DEFAULT_DISPLAY_ZONE, { year = false } = {}) {
  const p = zonedParts(instant, zone);
  if (!p) return '';
  const [y, m, d] = p.iso.split('-').map(Number);
  return `${MONTHS[m - 1].slice(0, 3)} ${d}${year ? `, ${y}` : ''}, ${formatClock(instant, zone)}`;
}

/** "Friday, October 9" for an ISO day. */
export function formatLongDay(iso) {
  const [, m, d] = iso.split('-').map(Number);
  return `${WEEKDAYS_LONG[weekday(iso)]}, ${MONTHS[m - 1]} ${d}`;
}

export function isoWeekStart(year, week) {
  const jan4 = Date.UTC(year, 0, 4) / DAY_MS;
  const jan4Weekday = (new Date(jan4 * DAY_MS).getUTCDay() + 6) % 7; // Monday = 0
  return isoFromNum(jan4 - jan4Weekday + (week - 1) * 7);
}

export function isoWeekOf(iso) {
  const n = dayNum(iso);
  const mondayBased = (weekday(iso) + 6) % 7;
  const thursday = n - mondayBased + 3;
  const year = Number(isoFromNum(thursday).slice(0, 4));
  const week = Math.floor((thursday - dayNum(`${year}-01-01`)) / 7) + 1;
  return `${year}-W${pad(week)}`;
}

export const monthValueOf = (iso) => iso.slice(0, 7);
export const quarterValueOf = (iso) => `${iso.slice(0, 4)}-Q${Math.floor((Number(iso.slice(5, 7)) - 1) / 3) + 1}`;

function lastDayOfMonth(year, month) {
  return isoFromNum(Date.UTC(year, month, 1) / DAY_MS - 1);
}

/** Inclusive [first, last] ISO days covered by a precision/value pair, or null. */
export function periodBounds(precision, value) {
  if (typeof value !== 'string') return null;
  let m;
  switch (precision) {
    case 'day':
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
      if (isoFromNum(dayNum(value)) !== value) return null;
      return [value, value];
    case 'week':
      m = /^(\d{4})-W(\d{2})$/.exec(value);
      if (!m) return null;
      {
        const start = isoWeekStart(Number(m[1]), Number(m[2]));
        if (isoWeekOf(start) !== value) return null;
        return [start, addDays(start, 6)];
      }
    case 'month':
      m = /^(\d{4})-(\d{2})$/.exec(value);
      if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) return null;
      return [`${value}-01`, lastDayOfMonth(Number(m[1]), Number(m[2]))];
    case 'quarter':
      m = /^(\d{4})-Q([1-4])$/.exec(value);
      if (!m) return null;
      {
        const startMonth = Number(m[2]) * 3 - 2;
        return [`${m[1]}-${pad(startMonth)}-01`, lastDayOfMonth(Number(m[1]), startMonth + 2)];
      }
    case 'year':
      if (!/^\d{4}$/.test(value)) return null;
      return [`${value}-01-01`, `${value}-12-31`];
    default:
      return null;
  }
}

/** The value of `precision` that contains a given ISO day. */
export function valueContaining(precision, iso) {
  switch (precision) {
    case 'day': return iso;
    case 'week': return isoWeekOf(iso);
    case 'month': return monthValueOf(iso);
    case 'quarter': return quarterValueOf(iso);
    case 'year': return iso.slice(0, 4);
    default: return '';
  }
}

export function formatTime(hhmm) {
  if (!hhmm) return '';
  const [h, m] = hhmm.split(':').map(Number);
  const suffix = h < 12 ? 'AM' : 'PM';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${hour} ${suffix}` : `${hour}:${pad(m)} ${suffix}`;
}

function formatTimeRange(start, end) {
  if (!end) return formatTime(start);
  const a = formatTime(start);
  const b = formatTime(end);
  const sa = a.slice(-2);
  return sa === b.slice(-2) ? `${a.slice(0, -3)}–${b}` : `${a}–${b}`;
}

export function formatDay(iso, { year = 'auto', weekday: showWeekday = true, today = null } = {}) {
  const [y, m, d] = iso.split('-').map(Number);
  const showYear = year === true || (year === 'auto' && today && Number(today.slice(0, 4)) !== y);
  const parts = [];
  if (showWeekday) parts.push(`${WEEKDAYS[weekday(iso)]},`);
  parts.push(`${MONTHS[m - 1].slice(0, 3)} ${d}`);
  if (showYear) parts.push(String(y));
  return parts.join(' ');
}

export function monthName(month) { return MONTHS[month - 1]; }
export const WEEKDAY_SHORT = WEEKDAYS;

/** Human label for a date entry's value, honouring its precision. */
export function formatValue(entry, today = null) {
  const { precision, value } = entry;
  const bounds = periodBounds(precision, value);
  if (!bounds) return value || '';
  switch (precision) {
    case 'day': {
      let text = formatDay(value, { today });
      if (entry.time) text += ` · ${formatTimeRange(entry.time, entry.end_time)}${entry.tz_abbr ? ` ${entry.tz_abbr}` : ''}`;
      return text;
    }
    case 'week': return `Week of ${formatDay(bounds[0], { weekday: false, today })}`;
    case 'month': {
      const [y, m] = value.split('-').map(Number);
      return today && Number(today.slice(0, 4)) === y ? MONTHS[m - 1] : `${MONTHS[m - 1]} ${y}`;
    }
    case 'quarter': {
      const [y, q] = value.split('-');
      return `${q} ${y}`;
    }
    default: return value;
  }
}

/** Short label for chips: "Nov 14", "Q2 2027", "Nov". */
export function formatShort(entry, today = null) {
  const { precision, value } = entry;
  const bounds = periodBounds(precision, value);
  if (!bounds) return value || '';
  if (precision === 'day') {
    let text = formatDay(value, { weekday: false, today });
    if (entry.time) text += ` ${formatTime(entry.time)}`;
    return text;
  }
  if (precision === 'week') return `Wk of ${formatDay(bounds[0], { weekday: false, today })}`;
  if (precision === 'month') {
    const [y, m] = value.split('-').map(Number);
    const name = MONTHS[m - 1].slice(0, 3);
    return today && Number(today.slice(0, 4)) === y ? name : `${name} ${y}`;
  }
  return formatValue(entry, today);
}

/** A timed entry rendered in the owner's display zone, when its own zone differs. */
export function viewerLocalTime(entry, viewerZone) {
  if (!entry.instant || !entry.tz || entry.tz === viewerZone) return '';
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: viewerZone, weekday: 'short', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
    });
    return fmt.format(new Date(entry.instant));
  } catch {
    return '';
  }
}

export function relativeDays(fromIso, toIso) {
  const diff = dayNum(toIso) - dayNum(fromIso);
  if (diff === 0) return 'today';
  if (diff === 1) return 'tomorrow';
  if (diff === -1) return 'yesterday';
  const abs = Math.abs(diff);
  let text;
  if (abs < 14) text = `${abs} days`;
  else if (abs < 60) text = `${Math.round(abs / 7)} weeks`;
  else if (abs < 730) text = `${Math.round(abs / 30.4)} months`;
  else text = `${Math.round(abs / 365.25)} years`;
  return diff > 0 ? `in ${text}` : `${text} ago`;
}

/**
 * Where an entry stands relative to today:
 * 'overdue' (open deadline whose period ended), 'passed', 'current' (period
 * contains today), 'today' (day entry on today) or 'upcoming'.
 */
export function dateState(entry, today, itemOpen = true) {
  const bounds = periodBounds(entry.precision, entry.value);
  if (!bounds) return 'upcoming';
  const t = dayNum(today);
  if (dayNum(bounds[1]) < t) return entry.kind === 'deadline' && itemOpen ? 'overdue' : 'passed';
  if (dayNum(bounds[0]) > t) return 'upcoming';
  return entry.precision === 'day' ? 'today' : 'current';
}

/** The single most relevant date for a card: earliest not-yet-ended, else most recent. */
export function primaryDate(dates, today) {
  if (!dates || !dates.length) return null;
  const t = dayNum(today);
  const withBounds = dates
    .map((d) => ({ d, b: periodBounds(d.precision, d.value) }))
    .filter((x) => x.b);
  const open = withBounds
    .filter((x) => dayNum(x.b[1]) >= t)
    .sort((a, b) => dayNum(a.b[0]) - dayNum(b.b[0]) || (a.d.time || '').localeCompare(b.d.time || ''));
  if (open.length) return open[0].d;
  const past = withBounds.sort((a, b) => dayNum(b.b[1]) - dayNum(a.b[1]));
  return past.length ? past[0].d : null;
}

/** Weeks (arrays of 7 ISO days) covering a month, starting on Sunday or Monday. */
export function monthGrid(year, month, weekStart = 'sun') {
  const first = `${year}-${pad(month)}-01`;
  const last = lastDayOfMonth(year, month);
  const startOffset = (weekday(first) - (weekStart === 'mon' ? 1 : 0) + 7) % 7;
  let cursor = addDays(first, -startOffset);
  const weeks = [];
  while (dayNum(cursor) <= dayNum(last)) {
    const week = [];
    for (let i = 0; i < 7; i += 1) {
      week.push(cursor);
      cursor = addDays(cursor, 1);
    }
    weeks.push(week);
  }
  return weeks;
}

export function shiftMonth(year, month, delta) {
  const index = year * 12 + (month - 1) + delta;
  return [Math.floor(index / 12), (index % 12) + 1];
}

/** Does the inclusive period [a0,a1] overlap [b0,b1]? (ISO days) */
export function overlaps(a, b) {
  return dayNum(a[0]) <= dayNum(b[1]) && dayNum(b[0]) <= dayNum(a[1]);
}

/** Default value for a precision when switching an editor, anchored near `iso`. */
export function defaultValueFor(precision, iso) {
  return valueContaining(precision, iso);
}
