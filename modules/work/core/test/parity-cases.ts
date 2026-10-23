import type { FieldError } from '../types';

// Validation parity table. Each expectation is written from the Planner's
// authoritative rules (planning/validation.py and planning/dates.py at the D-1
// commit), not from the HQ implementation. Inputs are synthetic. Entry ids
// that the service would generate come from a deterministic `gen-NNNNNN`
// sequence in both the HQ test and the Python oracle run.

export type Expectation = { ok: true; value: Record<string, unknown> } | { ok: false; errors: FieldError[] };
export interface FieldCase { name: string; creating: boolean; input: unknown; expect: Expectation }
export interface SettingsCase { name: string; input: unknown; expect: Expectation }

const a = (n: number, ch = 'a') => ch.repeat(n);
const err = (field: string, message: string): Expectation => ({ ok: false, errors: [{ field, message }] });
const EMPTY = { kind: 'idea', status: 'inbox', motivation: null, horizon: null, priority: null, area: null, notes: '', next_steps: [], references: [], dates: [] };
const created = (fields: Record<string, unknown>): Expectation => ({ ok: true, value: { ...EMPTY, title: 'Card', ...fields } });
const withDate = (entry: Record<string, unknown>) => ({ title: 'Card', dates: [{ id: 'date-001', ...entry }] });
const dateOk = (entry: Record<string, unknown>) => created({ dates: [{ id: 'date-001', time: null, end_time: null, tz: null, note: '', ...entry }] });
const day = { kind: 'deadline', precision: 'day' };

export const FIELD_CASES: FieldCase[] = [
  // body
  { name: 'body must be an object', creating: true, input: 'card', expect: err('body', 'Expected an object of fields.') },
  { name: 'unknown fields are listed sorted', creating: true, input: { title: 'Card', zzz: 1, aaa: 2 }, expect: err('body', 'Unknown field(s): aaa, zzz.') },
  { name: 'an empty patch changes nothing', creating: false, input: {}, expect: err('body', 'Nothing to change.') },
  { name: 'create applies defaults', creating: true, input: { title: 'Card' }, expect: created({}) },
  { name: 'a patch returns only supplied keys', creating: false, input: { area: '  Home  ' }, expect: { ok: true, value: { area: 'Home' } } },
  { name: 'the service itself accepts a status patch', creating: false, input: { status: 'done' }, expect: { ok: true, value: { status: 'done' } } },
  { name: 'errors aggregate across fields', creating: true, input: { title: '', kind: 'task' }, expect: { ok: false, errors: [{ field: 'title', message: 'Required.' }, { field: 'kind', message: 'Choose one of: project, idea, goal, chore.' }] } },
  // title
  { name: 'title is required', creating: true, input: {}, expect: err('title', 'Required.') },
  { name: 'blank title is required', creating: true, input: { title: '   ' }, expect: err('title', 'Required.') },
  { name: 'title whitespace collapses', creating: true, input: { title: '  Plan   the\tday \n' }, expect: created({ title: 'Plan the day' }) },
  { name: 'title over 200 characters', creating: true, input: { title: a(201) }, expect: err('title', 'Limited to 200 characters.') },
  { name: 'title limit counts code points', creating: true, input: { title: a(200, '\u{1F331}') }, expect: created({ title: a(200, '\u{1F331}') }) },
  { name: 'title NUL is a control character', creating: true, input: { title: 'a\u0000b' }, expect: err('title', 'Contains unsupported control characters.') },
  { name: 'title DEL is a control character', creating: true, input: { title: 'a\u007fb' }, expect: err('title', 'Contains unsupported control characters.') },
  { name: 'title unit separator is Python whitespace', creating: true, input: { title: 'a\u001fb' }, expect: created({ title: 'a b' }) },
  { name: 'title must be text', creating: true, input: { title: 123 }, expect: err('title', 'Must be text.') },
  // enums
  { name: 'unknown kind', creating: true, input: { title: 'Card', kind: 'task' }, expect: err('kind', 'Choose one of: project, idea, goal, chore.') },
  { name: 'null kind on create is required', creating: true, input: { title: 'Card', kind: null }, expect: err('kind', 'Required.') },
  { name: 'unknown status', creating: true, input: { title: 'Card', status: 'later' }, expect: err('status', 'Choose one of: inbox, considering, next, active, on_hold, done, dropped.') },
  { name: 'empty status is required', creating: true, input: { title: 'Card', status: '' }, expect: err('status', 'Required.') },
  { name: 'unknown motivation', creating: true, input: { title: 'Card', motivation: 'maybe' }, expect: err('motivation', 'Choose one of: need, want, exploring.') },
  { name: 'empty horizon is null', creating: true, input: { title: 'Card', horizon: '' }, expect: created({}) },
  { name: 'unknown priority', creating: true, input: { title: 'Card', priority: 'urgent' }, expect: err('priority', 'Choose one of: high, normal, low.') },
  { name: 'every enum value accepted', creating: true, input: { title: 'Card', kind: 'chore', status: 'on_hold', motivation: 'exploring', horizon: 'someday', priority: 'low' }, expect: created({ kind: 'chore', status: 'on_hold', motivation: 'exploring', horizon: 'someday', priority: 'low' }) },
  // area and notes
  { name: 'area over 40 characters', creating: true, input: { title: 'Card', area: a(41) }, expect: err('area', 'Limited to 40 characters.') },
  { name: 'blank area is null', creating: true, input: { title: 'Card', area: '   ' }, expect: created({}) },
  { name: 'notes over 20,000 characters', creating: true, input: { title: 'Card', notes: a(20_001) }, expect: err('notes', 'Limited to 20000 characters.') },
  { name: 'notes line endings normalize', creating: true, input: { title: 'Card', notes: 'a\r\nb\rc' }, expect: created({ notes: 'a\nb\nc' }) },
  { name: 'notes vertical tab is a control character', creating: true, input: { title: 'Card', notes: 'a\u000bb' }, expect: err('notes', 'Contains unsupported control characters.') },
  { name: 'notes keep tab and DEL', creating: true, input: { title: 'Card', notes: 'a\tb\u007f' }, expect: created({ notes: 'a\tb\u007f' }) },
  // next steps
  { name: 'steps must be a list', creating: true, input: { title: 'Card', next_steps: 'x' }, expect: err('next_steps', 'Must be a list.') },
  { name: 'more than 100 steps', creating: true, input: { title: 'Card', next_steps: Array.from({ length: 101 }, () => ({ text: 'x' })) }, expect: err('next_steps', 'Limited to 100 steps.') },
  { name: 'step with an extra key', creating: true, input: { title: 'Card', next_steps: [{ text: 'a', extra: 1 }] }, expect: err('next_steps', 'Step 1 is malformed.') },
  { name: 'step text is required', creating: true, input: { title: 'Card', next_steps: [{ done: false }] }, expect: err('next_steps', 'Required.') },
  { name: 'step text over 300 characters', creating: true, input: { title: 'Card', next_steps: [{ text: a(301) }] }, expect: err('next_steps', 'Limited to 300 characters.') },
  { name: 'step done must be a boolean', creating: true, input: { title: 'Card', next_steps: [{ text: 'a', done: 'yes' }] }, expect: err('next_steps', 'Step 1 is malformed.') },
  { name: 'duplicate step ids', creating: true, input: { title: 'Card', next_steps: [{ id: 'step-01', text: 'a' }, { id: 'step-01', text: 'b' }] }, expect: err('next_steps', 'Step 2 is malformed.') },
  { name: 'step id too short', creating: true, input: { title: 'Card', next_steps: [{ id: 'abc', text: 'a' }] }, expect: err('next_steps', 'Step 1 is malformed.') },
  { name: 'valid steps, one with a generated id', creating: true, input: { title: 'Card', next_steps: [{ id: 'step-01', text: ' Buy   paint ', done: true }, { text: 'Sand' }] }, expect: created({ next_steps: [{ id: 'step-01', text: 'Buy paint', done: true }, { id: 'gen-000001', text: 'Sand', done: false }] }) },
  // references
  { name: 'references must be a list', creating: true, input: { title: 'Card', references: {} }, expect: err('references', 'Must be a list.') },
  { name: 'more than 30 references', creating: true, input: { title: 'Card', references: Array.from({ length: 31 }, () => ({ label: 'x' })) }, expect: err('references', 'Limited to 30 references.') },
  { name: 'unknown reference kind', creating: true, input: { title: 'Card', references: [{ kind: 'video', label: 'x' }] }, expect: err('references', 'Reference 1 has an unknown kind.') },
  { name: 'ftp link rejected', creating: true, input: { title: 'Card', references: [{ url: 'ftp://example.com/x' }] }, expect: err('references', 'Reference 1 link must be an http(s) address.') },
  { name: 'link with a space rejected', creating: true, input: { title: 'Card', references: [{ url: 'https://exa mple.com' }] }, expect: err('references', 'Reference 1 link must be an http(s) address.') },
  { name: 'link without a host rejected', creating: true, input: { title: 'Card', references: [{ url: 'http://' }] }, expect: err('references', 'Reference 1 link must be an http(s) address.') },
  { name: 'javascript link rejected', creating: true, input: { title: 'Card', references: [{ url: 'javascript:alert(1)' }] }, expect: err('references', 'Reference 1 link must be an http(s) address.') },
  { name: 'reference needs a label or link', creating: true, input: { title: 'Card', references: [{ label: '', url: '' }] }, expect: err('references', 'Reference 1 needs a label or link.') },
  { name: 'link over 2,000 characters', creating: true, input: { title: 'Card', references: [{ url: `https://example.com/${a(1981)}` }] }, expect: err('references', 'Reference 1 link is too long or invalid.') },
  { name: 'reference label over 200 characters', creating: true, input: { title: 'Card', references: [{ label: a(201) }] }, expect: err('references', 'Limited to 200 characters.') },
  { name: 'uppercase scheme accepted; label defaults to the link', creating: true, input: { title: 'Card', references: [{ id: 'ref-001', url: '  HTTPS://Example.com/Path  ' }] }, expect: created({ references: [{ id: 'ref-001', kind: 'url', label: 'HTTPS://Example.com/Path', url: 'HTTPS://Example.com/Path' }] }) },
  { name: 'label-only reference', creating: true, input: { title: 'Card', references: [{ kind: 'doc', label: 'Garden sketch' }] }, expect: created({ references: [{ id: 'gen-000001', kind: 'doc', label: 'Garden sketch', url: '' }] }) },
  { name: 'an HQ target is malformed without the feature', creating: true, input: { title: 'Card', references: [{ kind: 'hq', label: 'x', target: {} }] }, expect: err('references', 'Reference 1 is malformed.') },
  { name: 'the hq kind is unknown without the feature', creating: true, input: { title: 'Card', references: [{ kind: 'hq', label: 'x' }] }, expect: err('references', 'Reference 1 has an unknown kind.') },
  // dates
  { name: 'dates must be a list', creating: true, input: { title: 'Card', dates: 'soon' }, expect: err('dates', 'Must be a list.') },
  { name: 'more than 20 dates', creating: true, input: { title: 'Card', dates: Array.from({ length: 21 }, () => ({ kind: 'target', precision: 'year', value: '2027' })) }, expect: err('dates', 'Limited to 20 dates.') },
  { name: 'date must be an object', creating: true, input: { title: 'Card', dates: [5] }, expect: err('dates.dates', 'Date 1 must be an object.') },
  { name: 'date unknown fields', creating: true, input: withDate({ ...day, value: '2026-11-14', foo: 1, bar: 2 }), expect: err('dates.dates', 'Date 1 has unknown field(s): bar, foo.') },
  { name: 'date kind', creating: true, input: withDate({ kind: 'due', precision: 'day', value: '2026-11-14' }), expect: err('dates.kind', 'Choose target, deadline, start or event.') },
  { name: 'date precision', creating: true, input: withDate({ kind: 'target', precision: 'hour', value: '2026-11-14' }), expect: err('dates.precision', 'Choose day, week, month, quarter or year.') },
  { name: 'date value required', creating: true, input: withDate({ ...day }), expect: err('dates.value', 'A date value is required.') },
  { name: 'day format', creating: true, input: withDate({ ...day, value: '2026-2-1' }), expect: err('dates.value', 'Use a day like 2026-11-14.') },
  { name: 'day month 13', creating: true, input: withDate({ ...day, value: '2026-13-01' }), expect: err('dates.value', 'That calendar day does not exist.') },
  { name: 'day Feb 29 in a common year', creating: true, input: withDate({ ...day, value: '2027-02-29' }), expect: err('dates.value', 'That calendar day does not exist.') },
  { name: 'day Feb 29 in a leap year', creating: true, input: withDate({ ...day, value: '2028-02-29' }), expect: dateOk({ ...day, value: '2028-02-29' }) },
  { name: 'year below 1900', creating: true, input: withDate({ ...day, value: '1899-12-31' }), expect: err('dates.value', 'Year must be between 1900 and 2200.') },
  { name: 'year above 2200', creating: true, input: withDate({ kind: 'target', precision: 'year', value: '2201' }), expect: err('dates.value', 'Year must be between 1900 and 2200.') },
  { name: 'week format', creating: true, input: withDate({ kind: 'target', precision: 'week', value: '2026-W5' }), expect: err('dates.value', 'Use an ISO week like 2026-W46.') },
  { name: 'week 53 exists in 2026', creating: true, input: withDate({ kind: 'target', precision: 'week', value: '2026-W53' }), expect: dateOk({ kind: 'target', precision: 'week', value: '2026-W53' }) },
  { name: 'week 53 does not exist in 2027', creating: true, input: withDate({ kind: 'target', precision: 'week', value: '2027-W53' }), expect: err('dates.value', 'That ISO week does not exist.') },
  { name: 'week 00 does not exist', creating: true, input: withDate({ kind: 'target', precision: 'week', value: '2026-W00' }), expect: err('dates.value', 'That ISO week does not exist.') },
  { name: 'month format', creating: true, input: withDate({ kind: 'start', precision: 'month', value: '2026-1' }), expect: err('dates.value', 'Use a month like 2026-11.') },
  { name: 'month 13', creating: true, input: withDate({ kind: 'start', precision: 'month', value: '2026-13' }), expect: err('dates.value', 'Month must be 01 to 12.') },
  { name: 'quarter 5', creating: true, input: withDate({ kind: 'target', precision: 'quarter', value: '2027-Q5' }), expect: err('dates.value', 'Use a quarter like 2027-Q2.') },
  { name: 'year format', creating: true, input: withDate({ kind: 'target', precision: 'year', value: '27' }), expect: err('dates.value', 'Use a year like 2027.') },
  { name: 'every precision accepted', creating: true, input: { title: 'Card', dates: [{ id: 'date-001', kind: 'target', precision: 'month', value: '2026-11' }, { id: 'date-002', kind: 'event', precision: 'quarter', value: '2027-Q2' }, { id: 'date-003', kind: 'start', precision: 'year', value: '2027' }] }, expect: created({ dates: [{ id: 'date-001', kind: 'target', precision: 'month', value: '2026-11', time: null, end_time: null, tz: null, note: '' }, { id: 'date-002', kind: 'event', precision: 'quarter', value: '2027-Q2', time: null, end_time: null, tz: null, note: '' }, { id: 'date-003', kind: 'start', precision: 'year', value: '2027', time: null, end_time: null, tz: null, note: '' }] }) },
  { name: 'value is stripped', creating: true, input: withDate({ ...day, value: ' 2026-11-14 ' }), expect: dateOk({ ...day, value: '2026-11-14' }) },
  { name: 'only a day can have a time', creating: true, input: withDate({ kind: 'event', precision: 'week', value: '2026-W46', time: '09:30', tz: 'America/New_York' }), expect: err('dates.time', 'Only a specific day can have a time.') },
  { name: 'time format', creating: true, input: withDate({ ...day, value: '2026-11-14', time: '9:30', tz: 'America/New_York' }), expect: err('dates.time', 'Use a 24-hour time like 14:30.') },
  { name: 'time 24:00 rejected', creating: true, input: withDate({ ...day, value: '2026-11-14', time: '24:00', tz: 'America/New_York' }), expect: err('dates.time', 'Use a 24-hour time like 14:30.') },
  { name: 'a timed date needs a zone', creating: true, input: withDate({ ...day, value: '2026-11-14', time: '09:30' }), expect: err('dates.tz', 'A timed date needs a valid time zone, such as America/New_York.') },
  { name: 'an unknown zone', creating: true, input: withDate({ ...day, value: '2026-11-14', time: '09:30', tz: 'Mars/Olympus' }), expect: err('dates.tz', 'A timed date needs a valid time zone, such as America/New_York.') },
  { name: 'a lowercase zone', creating: true, input: withDate({ ...day, value: '2026-11-14', time: '09:30', tz: 'america/new_york' }), expect: err('dates.tz', 'A timed date needs a valid time zone, such as America/New_York.') },
  { name: 'DST gap rejected', creating: true, input: withDate({ ...day, value: '2026-03-08', time: '02:30', tz: 'America/New_York' }), expect: err('dates.time', '02:30 does not exist on 2026-03-08 in America/New_York (clock change).') },
  { name: 'DST overlap accepted', creating: true, input: withDate({ ...day, value: '2026-11-01', time: '01:30', tz: 'America/New_York' }), expect: dateOk({ ...day, value: '2026-11-01', time: '01:30', tz: 'America/New_York' }) },
  { name: 'DST gap in another zone', creating: true, input: withDate({ ...day, value: '2026-03-29', time: '02:15', tz: 'Europe/Berlin' }), expect: err('dates.time', '02:15 does not exist on 2026-03-29 in Europe/Berlin (clock change).') },
  { name: 'end time in a DST gap', creating: true, input: withDate({ ...day, value: '2026-03-08', time: '01:00', end_time: '02:15', tz: 'America/New_York' }), expect: err('dates.end_time', '02:15 does not exist on 2026-03-08 in America/New_York (clock change).') },
  { name: 'end time must follow the start', creating: true, input: withDate({ ...day, value: '2026-11-14', time: '10:00', end_time: '10:00', tz: 'America/New_York' }), expect: err('dates.end_time', 'End time must be after the start time on the same day.') },
  { name: 'end time format', creating: true, input: withDate({ ...day, value: '2026-11-14', time: '10:00', end_time: '15:3', tz: 'America/New_York' }), expect: err('dates.end_time', 'Use a 24-hour end time like 15:30.') },
  { name: 'end time needs a start', creating: true, input: withDate({ ...day, value: '2026-11-14', end_time: '10:00' }), expect: err('dates.end_time', 'An end time needs a start time.') },
  { name: 'timed range accepted', creating: true, input: withDate({ ...day, value: '2026-11-14', time: '10:00', end_time: '11:30', tz: 'Europe/Berlin' }), expect: dateOk({ ...day, value: '2026-11-14', time: '10:00', end_time: '11:30', tz: 'Europe/Berlin' }) },
  { name: 'a zone without a time is dropped', creating: true, input: withDate({ ...day, value: '2026-11-14', tz: 'America/New_York' }), expect: dateOk({ ...day, value: '2026-11-14' }) },
  { name: 'empty time means untimed', creating: true, input: withDate({ ...day, value: '2026-11-14', time: '', tz: 'America/New_York' }), expect: dateOk({ ...day, value: '2026-11-14' }) },
  { name: 'derived fields are accepted and stripped', creating: true, input: withDate({ ...day, value: '2026-11-14', time: '10:00', tz: 'America/New_York', instant: '2026-11-14T15:00:00Z', tz_abbr: 'EST' }), expect: dateOk({ ...day, value: '2026-11-14', time: '10:00', tz: 'America/New_York' }) },
  { name: 'date note over 120 characters', creating: true, input: withDate({ ...day, value: '2026-11-14', note: a(121) }), expect: err('dates.note', 'Date note is limited to 120 characters.') },
  { name: 'date note must be one line', creating: true, input: withDate({ ...day, value: '2026-11-14', note: 'a\nb' }), expect: err('dates.note', 'Date note must be a single line.') },
  { name: 'date note is stripped', creating: true, input: withDate({ ...day, value: '2026-11-14', note: '  bring gloves  ' }), expect: dateOk({ ...day, value: '2026-11-14', note: 'bring gloves' }) },
  { name: 'date note must be text', creating: true, input: withDate({ ...day, value: '2026-11-14', note: 5 }), expect: err('dates.note', 'Date note must be text.') },
  { name: 'malformed date id', creating: true, input: withDate({ ...day, value: '2026-11-14', id: 'bad id' }), expect: err('dates.id', 'Date id is malformed.') },
  { name: 'duplicate date ids', creating: true, input: { title: 'Card', dates: [{ id: 'date-001', kind: 'target', precision: 'year', value: '2027' }, { id: 'date-001', kind: 'target', precision: 'year', value: '2028' }] }, expect: err('dates', 'Duplicate date id.') },
  { name: 'a date without an id gets one', creating: true, input: { title: 'Card', dates: [{ kind: 'target', precision: 'year', value: '2027' }] }, expect: created({ dates: [{ id: 'gen-000001', kind: 'target', precision: 'year', value: '2027', time: null, end_time: null, tz: null, note: '' }] }) },
];

export const SETTINGS_CASES: SettingsCase[] = [
  { name: 'settings must change something', input: {}, expect: err('settings', 'Expected settings to change.') },
  { name: 'unknown zone', input: { default_tz: 'Mars/Olympus' }, expect: err('default_tz', 'Unknown time zone.') },
  { name: 'week start', input: { week_start: 'tue' }, expect: err('week_start', 'Choose sun or mon.') },
  { name: 'stale days below range', input: { stale_days: 0 }, expect: err('stale_days', 'Use a whole number of days from 1 to 365.') },
  { name: 'stale days above range', input: { stale_days: 366 }, expect: err('stale_days', 'Use a whole number of days from 1 to 365.') },
  { name: 'stale days boolean', input: { stale_days: true }, expect: err('stale_days', 'Use a whole number of days from 1 to 365.') },
  { name: 'unknown setting', input: { color: 'teal' }, expect: err('color', 'Unknown setting.') },
  { name: 'valid change merges', input: { default_tz: 'Europe/Paris', week_start: 'mon', stale_days: 7 }, expect: { ok: true, value: { default_tz: 'Europe/Paris', week_start: 'mon', stale_days: 7 } } },
];
