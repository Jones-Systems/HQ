// "Today" and clock times follow the owner's display zone (settings.default_tz,
// America/New_York by default), never the host/browser zone. The process zone
// is pinned far from Eastern so a browser-local fallback would fail here.

process.env.TZ = 'Asia/Tokyo';

import assert from 'node:assert/strict';
import test from 'node:test';

const {
  DEFAULT_DISPLAY_ZONE, formatClock, formatLongDay, formatStamp, resolveZone, todayISO, viewerLocalTime, zonedParts,
} = await import('../public/js/dates.js');
const { reviewBuckets, untouchedDays } = await import('../public/js/model.js');
const { displayToday, displayZone, state } = await import('../public/js/state.js');

const NY = 'America/New_York';
// The reported case: 22:36Z on Oct 9 is still Friday evening in New York, while
// a UTC+2 browser had already reached Saturday 12:36 AM.
const REPORTED = new Date('2026-10-09T22:36:00Z');

test('today is the Eastern date, not the host date, at the evening boundary', () => {
  assert.equal(DEFAULT_DISPLAY_ZONE, NY);
  assert.equal(todayISO(REPORTED), '2026-10-09');
  assert.equal(todayISO(REPORTED, NY), '2026-10-09');
  assert.equal(todayISO(REPORTED, 'UTC'), '2026-10-09');
  assert.equal(todayISO(REPORTED, 'Europe/Berlin'), '2026-10-10');
  assert.equal(formatLongDay(todayISO(REPORTED)), 'Friday, October 9');
  // Eastern midnight is the boundary, in both EST and EDT.
  assert.equal(todayISO(new Date('2027-01-01T04:59:00Z')), '2026-12-31');
  assert.equal(todayISO(new Date('2027-01-01T05:00:00Z')), '2027-01-01');
  assert.equal(todayISO(new Date('2026-07-05T03:59:00Z')), '2026-07-04');
  assert.equal(todayISO(new Date('2026-07-05T04:00:00Z')), '2026-07-05');
});

test('clock times carry the correct EDT/EST abbreviation', () => {
  assert.equal(formatClock(REPORTED), '6:36 PM EDT');
  assert.equal(formatClock(new Date('2026-12-15T17:05:00Z'), NY), '12:05 PM EST');
  assert.equal(formatClock(new Date('2027-01-01T05:00:00Z'), NY), '12:00 AM EST');
  assert.equal(formatClock('2026-10-09T22:36:00.000Z', 'UTC'), '10:36 PM UTC');
  // Spring forward (Mar 8 2026) and fall back (Nov 1 2026).
  assert.equal(formatClock(new Date('2026-03-08T06:59:00Z')), '1:59 AM EST');
  assert.equal(formatClock(new Date('2026-03-08T07:00:00Z')), '3:00 AM EDT');
  assert.equal(formatClock(new Date('2026-11-01T05:30:00Z')), '1:30 AM EDT');
  assert.equal(formatClock(new Date('2026-11-01T06:30:00Z')), '1:30 AM EST');
});

test('stamps show the Eastern day with zone, and bad input stays blank', () => {
  assert.equal(formatStamp(REPORTED), 'Oct 9, 6:36 PM EDT');
  assert.equal(formatStamp(new Date('2026-12-01T03:15:00Z'), NY, { year: true }), 'Nov 30, 2026, 10:15 PM EST');
  assert.deepEqual(zonedParts(REPORTED, NY), { iso: '2026-10-09', hour: 18, minute: 36, abbr: 'EDT' });
  assert.equal(zonedParts('not a time', NY), null);
  assert.equal(formatClock('not a time'), '');
  assert.equal(formatStamp(undefined), '');
  assert.equal(resolveZone('Not/AZone'), NY);
  assert.equal(resolveZone(''), NY);
  assert.equal(resolveZone('Europe/London'), 'Europe/London');
});

test('another zone’s timed date is shown in the display zone with its abbreviation', () => {
  const entry = { instant: '2026-10-09T22:36:00Z', tz: 'Europe/London' };
  assert.equal(viewerLocalTime(entry, NY), 'Fri, 6:36 PM EDT');
  assert.equal(viewerLocalTime({ ...entry, tz: NY }, NY), '');
  assert.equal(viewerLocalTime({ precision: 'day', value: '2026-10-09' }, NY), '');
});

test('settings.default_tz drives the app clock, defaulting to New York', () => {
  const saved = state.settings;
  try {
    state.settings = { ...saved, default_tz: undefined };
    assert.equal(displayZone(), NY);
    assert.equal(displayToday(REPORTED), '2026-10-09');
    state.settings = { ...saved, default_tz: 'Europe/Berlin' };
    assert.equal(displayZone(), 'Europe/Berlin');
    assert.equal(displayToday(REPORTED), '2026-10-10');
    state.settings = { ...saved, default_tz: 'Bogus/Zone' };
    assert.equal(displayZone(), NY);
  } finally {
    state.settings = saved;
  }
});

test('quiet-day counting uses the display-zone day of the last touch', () => {
  // 02:00Z on Oct 10 is 10 PM EDT on Oct 9.
  const item = { updated_at: '2026-10-10T02:00:00.000Z', reviewed_at: null };
  assert.equal(untouchedDays(item, '2026-10-30', NY), 21);
  assert.equal(untouchedDays(item, '2026-10-30', 'UTC'), 20);
  assert.equal(untouchedDays(item, '2026-10-30'), 21);
  const active = { ...item, id: 'a', status: 'active', dates: [], archived_at: null };
  assert.equal(reviewBuckets([active], '2026-10-30', { stale_days: 21, default_tz: NY }).stale.length, 1);
  assert.equal(reviewBuckets([active], '2026-10-30', { stale_days: 21, default_tz: 'UTC' }).stale.length, 0);
});
