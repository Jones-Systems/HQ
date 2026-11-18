// Server-rendered markup for the Choose → Review → Done surface, plus how outcomes become toasts. Like panel.test.ts,
// this proves structure, words and states only: not layout, animation or the real @hq/ui components.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { announceOutcome, copyText, ImportsView, type ImportsActions, type ImportsCrossLink, type KitToast, type KitToastOptions } from '../src/ImportsPanel.ts';
import { createImportsController, type ImportsOutcome, type ImportsState } from '../src/controller.ts';
import { StorageConflictError } from '../src/contract.ts';
import { items, PROJECT, setup, source } from './fixtures.ts';

const NOW = Date.parse('2026-10-20T14:00:00.000Z');
const noop: ImportsActions = {
  choose() {}, apply() {}, async undo() {}, async resolve() {}, setExportChoice() {}, setConfirmPrivate() {}, exportNow() {},
  reset() {}, check() {}, dismiss() {},
};
const render = (state: ImportsState, extra: { crossLink?: ImportsCrossLink; actions?: ImportsActions } = {}): string =>
  renderToStaticMarkup(createElement(ImportsView, { state, actions: extra.actions ?? noop, now: NOW, ...(extra.crossLink === undefined ? {} : { crossLink: extra.crossLink }) }));

const screens = () => {
  const [home] = items(0);
  return source(0, { items: [home!, { ...home!, key: 'screens/settings.png', title: 'Settings', provenance: { originalName: 'settings.png' } }] });
};

test('stepper marks the current step, and earlier ones done with a spoken suffix', async () => {
  const { deps } = setup();
  const controller = createImportsController(deps, PROJECT, { pickSource: async () => source(0) });
  const choose = render(controller.getState());
  assert.match(choose, /data-state="current" aria-current="step"><span class="hqd-imports__step-mark" aria-hidden="true">1<\/span><span class="hqd-imports__step-label">Choose</u);
  assert.equal((choose.match(/aria-current="step"/gu) ?? []).length, 1);
  assert.match(choose, /Drag and drop is not available in this build\./u, 'it does not pretend to accept drops');
  await controller.choose();
  const review = render(controller.getState());
  assert.match(review, /data-state="done"[^>]*><span class="hqd-imports__step-mark"[^>]*><svg/u, 'Choose is done and shows a check, not a number');
  assert.match(review, /Choose<\/span><span class="hq-sr-only"> \(completed\)<\/span>/u);
  assert.match(review, /data-state="current" aria-current="step"><span class="hqd-imports__step-mark" aria-hidden="true">2<\/span>/u);
  assert.match(review, /<h3 id="hqd-imports-review" tabindex="-1" data-step-heading="review">Review the import<\/h3>/u, 'the step heading can take focus');
});

test('review rows carry a word and a kind, and stagger in', async () => {
  const { deps } = setup();
  const controller = createImportsController(deps, PROJECT, { pickSource: async () => source(0) });
  await controller.choose();
  const html = render(controller.getState());
  assert.match(html, /<ul class="hqd-imports__rows hq-stagger" aria-label="Import preview">/u);
  assert.equal((html.match(/data-kind="new"/gu) ?? []).length, 4);
  assert.match(html, /<\/svg>New<\/span><span class="hqd-imports__row-main"><span class="hqd-imports__key">prototypes\/landing<\/span><span class="hqd-imports__note">Will be added<\/span>/u);
  assert.match(html, /<button type="button" class="hq-btn hq-btn--primary">Apply import<\/button>/u);
});

test('a rejection does not repeat itself: rows say rejected, the notice carries the words, Apply is gone', async () => {
  const { deps } = setup();
  const controller = createImportsController(deps, PROJECT, { pickSource: async () => source(0, { version: 7 }) });
  await controller.choose();
  const html = render(controller.getState());
  assert.match(html, /data-kind="rejected"/u);
  assert.match(html, /<\/svg>Rejected<\/span>/u);
  assert.match(html, /<div role="alert" data-tone="danger"><strong>Couldn(?:'|&#x27;)t import these files<\/strong><span>[^<]*newer format version[^<]*Nothing was written\.<\/span>/u);
  assert.doesNotMatch(html, /class="hqd-imports__headline"/u);
  assert.doesNotMatch(html, />Apply import</u);
});

test('an unknown result shows Check in place and holds Apply until it is answered', async () => {
  const { storage, deps } = setup();
  const controller = createImportsController(deps, PROJECT, { pickSource: async () => source(0) });
  await controller.choose();
  storage.failNextCommit(new Error('The store did not answer'));
  await controller.apply();
  const html = render(controller.getState());
  assert.match(html, /<div role="alert" data-tone="unknown"><strong>Import result unknown<\/strong>/u);
  assert.match(html, /<button type="button">Check<\/button>/u);
  assert.match(html, /<button type="button" class="hq-btn hq-btn--primary" disabled="">Apply import<\/button>/u);
});

test('Done says what landed, offers Undo and Import more, and the timeline shows relative time with the exact time', async () => {
  const { deps } = setup();
  const controller = createImportsController(deps, PROJECT, { pickSource: async () => screens() });
  await controller.choose();
  await controller.apply();
  const html = render(controller.getState());
  assert.match(html, /<h3 id="hqd-imports-done" tabindex="-1" data-step-heading="done">Imported 2 screens<\/h3>/u);
  assert.match(html, /2 new · 0 updated · 0 unchanged · 0 conflicts/u);
  assert.match(html, /aria-label="What landed"/u);
  assert.match(html, />Undo import<\/button>/u);
  assert.match(html, />Import more<\/button>/u);
  assert.match(html, /data-state="current" aria-current="step"><span class="hqd-imports__step-mark" aria-hidden="true"><svg[^>]*>.*?<\/svg><\/span><span class="hqd-imports__step-label">Done/u);
  const time = /<time dateTime="([^"]+)" title="([^"]+)">([^<]+)<\/time>/u.exec(html);
  assert.ok(time, 'history has a <time>');
  assert.match(time[2]!, /^\d{1,2} [A-Z][a-z]{2} \d{4}, \d{2}:\d{2} UTC$/u);
  assert.match(html, /<ol class="hqd-imports__timeline">/u);
});

test('an undone import is struck, labelled, and the Done step says so instead of claiming it landed', async () => {
  const { deps } = setup();
  const controller = createImportsController(deps, PROJECT, { pickSource: async () => screens() });
  await controller.choose();
  await controller.apply();
  await controller.undo(controller.getState().history[0]!.importId);
  const html = render(controller.getState());
  assert.match(html, /data-undone="true"/u);
  assert.match(html, /<s>2 items · 2 new · 0 updated · 0 conflicts<\/s>/u);
  assert.match(html, /Undone/u);
  assert.match(html, />Undid the import of 2 screens<\/h3>/u);
  assert.match(html, /aria-label="What was undone"/u);
  assert.doesNotMatch(html, />Undo import<\/button>/u, 'nothing left to undo');
  assert.doesNotMatch(html, /aria-label="Undo import from/u);
});

test('history is relative to the pinned clock', async () => {
  const { deps } = setup();
  const controller = createImportsController(deps, PROJECT, { pickSource: async () => source(0) });
  await controller.choose();
  await controller.apply();
  const html = render(controller.getState());
  assert.match(html, /<time dateTime="2026-10-20T12:00:00\.000Z" title="20 Oct 2026, 12:00 UTC">2 h ago<\/time>/u);
});

test('the cross-link to References renders only when the host provides one', async () => {
  const { deps } = setup();
  const state = createImportsController(deps, PROJECT).getState();
  assert.doesNotMatch(render(state), /Adding single screenshots/u);
  const html = render(state, { crossLink: { lead: 'Adding single screenshots?', label: 'Use References → Import screenshots', onOpen() {} } });
  assert.match(html, /Adding single screenshots\? <button type="button" class="hqd-imports__link">Use References → Import screenshots<\/button>/u);
});

test('open conflicts offer a labelled Keep mine / Take incoming pair', async () => {
  const { deps, clock } = setup();
  let seed = 0;
  const controller = createImportsController(deps, PROJECT, { pickSource: async () => source(seed) });
  await controller.choose();
  await controller.apply();
  const { editImportedRecord, listRecords } = await import('../src/importer.ts');
  const record = (await listRecords(deps, PROJECT)).find((item) => item.itemKey === 'screens/home.png')!;
  await editImportedRecord(deps, record.recordId, { notes: 'mine' });
  seed = 1;
  clock.tick();
  await controller.choose();
  assert.match(render(controller.getState()), /data-kind="conflict"/u, 'the plan already shows the conflict');
  await controller.apply();
  const html = render(controller.getState());
  assert.match(html, /<h3 id="hqd-imports-conflicts">Conflicts \(1\)<\/h3>/u);
  assert.match(html, /role="group" aria-label="Resolve screens\/home\.png"><button type="button">Keep mine<\/button><button type="button">Take incoming<\/button>/u);
});

test('the export receipt keeps the digest apart from its copy button and says it was not saved', async () => {
  const { deps } = setup();
  const controller = createImportsController(deps, PROJECT);
  await controller.exportNow();
  const html = render(controller.getState());
  assert.match(html, /<h4>Export receipt<\/h4>/u);
  assert.match(html, />Copy digest<\/button>/u);
  assert.match(html, /<dt>Digest<\/dt><dd><code>sha256:[0-9a-f]{64}<\/code><\/dd>/u);
  assert.match(html, /Prepared/u);
  assert.match(html, /Saving to disk is unavailable in this build\./u);
});

// ---------------------------------------------------------------------------

function fakeToast() {
  const calls: { readonly kind: string; readonly title?: string; readonly options?: KitToastOptions; readonly id?: string }[] = [];
  const toast: KitToast = {
    success: (title, options) => { calls.push({ kind: 'success', title, ...(options === undefined ? {} : { options }) }); return ''; },
    info: (title, options) => { calls.push({ kind: 'info', title, ...(options === undefined ? {} : { options }) }); return ''; },
    warning: (title, options) => { calls.push({ kind: 'warning', title, ...(options === undefined ? {} : { options }) }); return ''; },
    error: (title, options) => { calls.push({ kind: 'error', title, ...(options === undefined ? {} : { options }) }); return ''; },
    unknown: (title, options) => { calls.push({ kind: 'unknown', title, ...(options === undefined ? {} : { options }) }); return ''; },
    dismiss: (id) => { calls.push({ kind: 'dismiss', ...(id === undefined ? {} : { id }) }); },
  };
  return { calls, toast };
}

test('announce: a success that can be undone offers Undo, which undoes that import', async () => {
  const { deps } = setup();
  const controller = createImportsController(deps, PROJECT, { pickSource: async () => screens() });
  const { calls, toast } = fakeToast();
  controller.onOutcome((outcome) => announceOutcome(outcome, toast, controller));
  await controller.choose();
  await controller.apply();
  const call = calls.find((entry) => entry.kind === 'success')!;
  assert.equal(call.title, 'Imported 2 screens');
  assert.equal(call.options?.action?.label, 'Undo');
  assert.match(call.options!.id!, /^imports-applied-/u);
  assert.equal(controller.getState().history[0]!.undone, false);
  call.options!.action!.onAction();
  await new Promise((resolve) => { setTimeout(resolve, 20); });
  assert.equal(controller.getState().history[0]!.undone, true, 'the toast Undo acted on the import it was raised for');
  const undone = calls.filter((entry) => entry.kind === 'success').at(-1)!;
  assert.equal(undone.title, 'Undid the import');
  assert.ok(calls.some((entry) => entry.kind === 'dismiss' && /^imports-applied-/u.test(entry.id ?? '')), 'the stale Undo toast is withdrawn');
});

test('announce: failures are error toasts, an unknown result offers Check, and Check withdraws that toast', async () => {
  const { storage, deps } = setup();
  const controller = createImportsController(deps, PROJECT, { pickSource: async () => source(0) });
  const { calls, toast } = fakeToast();
  controller.onOutcome((outcome) => announceOutcome(outcome, toast, controller));
  await controller.choose();
  storage.failNextCommit(new StorageConflictError('Revision mismatch'));
  await controller.apply();
  assert.equal(calls.at(-1)!.kind, 'error');
  assert.equal(calls.at(-1)!.options?.action, undefined, 'no Retry: the owner re-reviews and applies again');
  storage.failNextCommit(new Error('Timed out'));
  await controller.apply();
  const unknown = calls.at(-1)!;
  assert.equal(unknown.kind, 'unknown');
  assert.equal(unknown.options?.action?.label, 'Check');
  assert.equal(unknown.options?.id, 'imports-unknown-result');
  unknown.options!.action!.onAction();
  await new Promise((resolve) => { setTimeout(resolve, 20); });
  assert.ok(calls.some((entry) => entry.kind === 'dismiss' && entry.id === 'imports-unknown-result'));
});

test('announce: info outcomes are info toasts with their words', () => {
  const { calls, toast } = fakeToast();
  const outcome: ImportsOutcome = { seq: 1, tone: 'info', where: 'export', title: 'Bundle prepared', detail: 'Saving to disk is unavailable in this build, so nothing was written.' };
  announceOutcome(outcome, toast, { async undo() {}, async check() {} });
  assert.deepEqual(calls, [{ kind: 'info', title: 'Bundle prepared', options: { description: outcome.detail } }]);
});

test('copyText never throws: no clipboard, a refusing clipboard and a working one', async () => {
  assert.equal(await copyText('sha256:abc', undefined), false);
  assert.equal(await copyText('sha256:abc', {}), false);
  assert.equal(await copyText('sha256:abc', { writeText: async () => { throw new Error('NotAllowedError'); } }), false);
  const written: string[] = [];
  assert.equal(await copyText('sha256:abc', { writeText: async (text) => { written.push(text); } }), true);
  assert.deepEqual(written, ['sha256:abc']);
});
