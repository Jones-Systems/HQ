// Date editor dialog: the non-drag way to add, reschedule, retime or remove
// a typed date. Converting a coarse date (month/quarter/year) to a specific
// day leaves the day empty so the owner chooses it; no day is invented.

import { changeDate } from './actions.js';
import {
  DATE_KINDS, KIND_HINT, KIND_LABEL, PRECISIONS, PRECISION_LABEL, formatDay, isoWeekOf, monthName, pad,
  periodBounds, valueContaining,
} from './dates.js';
import { h } from './dom.js';
import { displayToday, state } from './state.js';
import { field, openDialog, segmented } from './ui.js';

let zoneList = null;
function zones() {
  if (!zoneList) {
    try {
      zoneList = Intl.supportedValuesOf('timeZone');
    } catch {
      zoneList = ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'UTC', 'Europe/London'];
    }
  }
  return zoneList;
}

/**
 * Open the editor. `entry` edits an existing date; otherwise `defaults`
 * ({kind, precision, value}) seed a new one. Resolves when the dialog closes.
 */
export function openDateEditor({ item, entry = null, defaults = {}, title = null }) {
  const today = displayToday();
  const draft = {
    kind: entry?.kind || defaults.kind || 'target',
    precision: entry?.precision || defaults.precision || 'day',
    value: entry?.value || defaults.value || '',
    time: entry?.time || '',
    end_time: entry?.end_time || '',
    tz: entry?.tz || state.settings.default_tz || 'America/New_York',
    note: entry?.note || '',
  };
  let timed = Boolean(entry?.time);
  const errorBox = h('div', { class: 'form-error', role: 'alert', hidden: true });

  const kindControl = segmented({
    name: 'dk', label: 'Date kind',
    options: DATE_KINDS.map((k) => ({ id: k, label: KIND_LABEL[k], icon: k, hint: KIND_HINT[k] })),
    value: draft.kind,
    onChange: (v) => { draft.kind = v; kindHint.textContent = KIND_HINT[v]; },
  });
  const kindHint = h('p', { class: 'field-hint', text: KIND_HINT[draft.kind] });

  const precisionControl = segmented({
    name: 'dp', label: 'Precision', compact: true,
    options: PRECISIONS.map((p) => ({ id: p, label: PRECISION_LABEL[p] })),
    value: draft.precision,
    onChange: (v) => {
      const bounds = periodBounds(draft.precision, draft.value);
      draft.value = v === 'day' ? (draft.precision === 'day' ? draft.value : '')
        : bounds ? valueContaining(v, bounds[0]) : valueContaining(v, today);
      draft.precision = v;
      if (v !== 'day') timed = false;
      renderValue();
    },
  });

  const valueHost = h('div', { class: 'value-host' });
  const timeHost = h('div', { class: 'time-host' });

  function renderValue() {
    valueHost.replaceChildren();
    const p = draft.precision;
    if (p === 'day' || p === 'week') {
      const bounds = periodBounds(p, draft.value);
      const input = h('input', { type: 'date', class: 'input', value: bounds ? bounds[0] : '', required: true });
      const hint = h('span', { class: 'field-hint' });
      const sync = () => {
        if (!input.value) {
          draft.value = '';
          hint.textContent = p === 'day' ? 'Choose the day.' : 'Choose any day in the week.';
          return;
        }
        draft.value = p === 'day' ? input.value : isoWeekOf(input.value);
        if (p === 'week') {
          const b = periodBounds('week', draft.value);
          hint.textContent = `${draft.value}: ${formatDay(b[0], { weekday: false, today })} – ${formatDay(b[1], { weekday: false, today })}`;
        } else {
          hint.textContent = formatDay(draft.value, { today, year: true });
        }
      };
      input.addEventListener('change', sync);
      input.addEventListener('input', sync);
      sync();
      valueHost.append(field(p === 'day' ? 'Day' : 'A day in the week', input), hint);
    } else if (p === 'month') {
      const [yy, mm] = (draft.value || valueContaining('month', today)).split('-');
      const month = h('select', { class: 'select' });
      for (let i = 1; i <= 12; i += 1) month.append(h('option', { value: pad(i), text: monthName(i) }));
      month.value = mm;
      const year = yearInput(yy);
      const sync = () => { draft.value = `${year.value}-${month.value}`; };
      month.addEventListener('change', sync);
      year.addEventListener('input', sync);
      sync();
      valueHost.append(h('div', { class: 'field-row' }, field('Month', month), field('Year', year)));
    } else if (p === 'quarter') {
      const [yy, qq] = (draft.value || valueContaining('quarter', today)).split('-');
      const quarter = h('select', { class: 'select' });
      for (const q of ['Q1', 'Q2', 'Q3', 'Q4']) quarter.append(h('option', { value: q, text: q }));
      quarter.value = qq;
      const year = yearInput(yy);
      const sync = () => { draft.value = `${year.value}-${quarter.value}`; };
      quarter.addEventListener('change', sync);
      year.addEventListener('input', sync);
      sync();
      valueHost.append(h('div', { class: 'field-row' }, field('Quarter', quarter), field('Year', year)));
    } else {
      const year = yearInput(draft.value || today.slice(0, 4));
      const sync = () => { draft.value = year.value; };
      year.addEventListener('input', sync);
      sync();
      valueHost.append(field('Year', year));
    }
    renderTime();
  }

  function renderTime() {
    timeHost.replaceChildren();
    if (draft.precision !== 'day') {
      timeHost.append(h('p', { class: 'field-hint', text: 'Times apply to a specific day only. Coarse dates stay a period, not a pinned day.' }));
      return;
    }
    const toggle = h('input', { type: 'checkbox', checked: timed });
    toggle.addEventListener('change', () => { timed = toggle.checked; renderTime(); });
    timeHost.append(h('label', { class: 'check' }, toggle, h('span', { text: 'Specific time' })));
    if (!timed) return;
    const start = h('input', { type: 'time', class: 'input', value: draft.time, required: true });
    const end = h('input', { type: 'time', class: 'input', value: draft.end_time });
    const listId = 'tz-options';
    let datalist = document.getElementById(listId);
    if (!datalist) {
      datalist = h('datalist', { id: listId });
      for (const z of zones()) datalist.append(h('option', { value: z }));
      document.body.append(datalist);
    }
    const tz = h('input', { type: 'text', class: 'input', value: draft.tz, list: listId, autocomplete: 'off', spellcheck: false });
    start.addEventListener('input', () => { draft.time = start.value; });
    end.addEventListener('input', () => { draft.end_time = end.value; });
    tz.addEventListener('input', () => { draft.tz = tz.value.trim(); });
    timeHost.append(h('div', { class: 'field-row' }, field('Starts', start), field('Ends (optional)', end)),
      field('Time zone', tz, { hint: 'Timed dates keep this zone, so 9:00 AM stays 9:00 AM there even when you travel.' }));
  }

  const note = h('input', { type: 'text', class: 'input', value: draft.note, maxLength: 120, placeholder: 'Optional, e.g. “before the trip booking”' });
  note.addEventListener('input', () => { draft.note = note.value; });

  renderValue();
  const content = h('div', { class: 'date-editor' },
    h('div', { class: 'field' }, h('span', { class: 'field-label', text: 'Kind' }), kindControl, kindHint),
    h('div', { class: 'field' }, h('span', { class: 'field-label', text: 'Precision' }), precisionControl),
    valueHost, timeHost, field('Note', note), errorBox);

  return new Promise((resolve) => {
    let saved = false;
    // One change at a time: a double click must not send the edit twice.
    let busy = false;
    const once = (run) => async (ctx) => {
      if (busy) return;
      busy = true;
      try {
        await run(ctx);
      } finally {
        busy = false;
      }
    };
    const actions = [];
    if (entry) {
      actions.push({
        label: 'Remove date', kind: 'danger-ghost', icon: 'trash',
        onClick: once(async ({ close }) => {
          try {
            await changeDate(item, entry.id, null, { label: 'Remove date', message: `Removed ${KIND_LABEL[entry.kind].toLowerCase()} date.` });
            saved = true;
            close();
          } catch { /* reported */ }
        }),
      });
    }
    actions.push({ label: 'Cancel', onClick: ({ close }) => close() });
    actions.push({
      label: entry ? 'Save date' : 'Add date', kind: 'primary', icon: 'check',
      onClick: once(async ({ close }) => {
        const problem = localCheck(draft, timed);
        if (problem) {
          errorBox.textContent = problem;
          errorBox.hidden = false;
          return;
        }
        const next = {
          kind: draft.kind, precision: draft.precision, value: draft.value,
          time: timed ? draft.time : null, end_time: timed && draft.end_time ? draft.end_time : null,
          tz: timed ? draft.tz : null, note: draft.note.trim(),
        };
        try {
          await changeDate(item, entry?.id || null, next, {
            label: entry ? 'Reschedule' : 'Add date',
            message: entry ? 'Date updated.' : `${KIND_LABEL[next.kind]} date added.`,
          });
          saved = true;
          close();
        } catch (err) {
          errorBox.textContent = err.payload?.errors?.map((e) => e.message).join(' ') || err.message;
          errorBox.hidden = false;
        }
      }),
    });
    openDialog({
      title: title || (entry ? `Edit ${KIND_LABEL[entry.kind].toLowerCase()} date` : 'Add a date'),
      description: item.title,
      content,
      actions,
      size: 'md',
      onClose: () => resolve(saved),
    });
  });
}

function yearInput(value) {
  return h('input', { type: 'number', class: 'input input-year', min: '1900', max: '2200', step: '1', value, inputmode: 'numeric' });
}

function localCheck(draft, timed) {
  if (!periodBounds(draft.precision, draft.value)) {
    return draft.precision === 'day' ? 'Choose a day.' : 'Enter a valid date for this precision.';
  }
  if (timed) {
    if (!draft.time) return 'Enter a start time, or untick “Specific time”.';
    if (draft.end_time && draft.end_time <= draft.time) return 'End time must be after the start time.';
    if (!draft.tz) return 'Choose a time zone for a timed date.';
  }
  return null;
}
