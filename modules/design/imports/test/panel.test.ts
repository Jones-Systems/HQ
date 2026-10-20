// Server-rendered markup through the real React runtime. This proves element
// structure, labels and disabled states only, not layout or Electron behaviour.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ImportsPanel, ImportsView, type ImportsActions } from '../src/ImportsPanel.ts';
import { createImportsController, type ImportsState } from '../src/controller.ts';
import { PROJECT, setup, source } from './fixtures.ts';

const noop: ImportsActions = {
  choose() {}, apply() {}, async undo() {}, async resolve() {}, setExportChoice() {}, setConfirmPrivate() {}, exportNow() {},
};

function render(state: ImportsState): string {
  return renderToStaticMarkup(createElement(ImportsView, { state, actions: noop }));
}

test('panel renders unavailable capabilities and the default backup choice', () => {
  const { deps } = setup();
  const html = renderToStaticMarkup(createElement(ImportsPanel, { deps, projectId: PROJECT }));
  assert.match(html, /<h2 id="hqd-imports-title">Import and export<\/h2>/u);
  assert.match(html, /<button type="button" disabled="" aria-describedby="hqd-imports-pick-unavailable">Choose files…<\/button>/u);
  assert.match(html, /File selection is unavailable in this build\./u);
  assert.match(html, /Saving to disk is unavailable in this build\./u);
  assert.match(html, /<input type="radio" name="hqd-imports-export"(?=[^>]*value="backup")(?=[^>]*checked="")[^>]*\/>/u);
  assert.doesNotMatch(html, /<input type="radio"(?=[^>]*value="export")(?=[^>]*checked="")[^>]*\/>/u);
  assert.doesNotMatch(html, /type="checkbox"/u, 'private confirmation only appears for the draft backup');
});

test('panel renders a plan preview with apply, then a no-op preview without it', async () => {
  const { deps, clock } = setup();
  const controller = createImportsController(deps, PROJECT, { pickSource: async () => source(0) });
  await controller.choose();
  const planned = render(controller.getState());
  assert.match(planned, /4 items ready to import/u);
  assert.match(planned, /4 new · 0 updated · 0 unchanged · 0 conflicts/u);
  assert.match(planned, /aria-label="Import preview"/u);
  assert.match(planned, />Apply import</u);
  await controller.apply();
  clock.tick();
  await controller.choose();
  const repeat = render(controller.getState());
  assert.match(repeat, /Already imported\. Applying would change nothing\./u);
  assert.doesNotMatch(repeat, />Apply import</u);
  assert.match(repeat, /aria-label="Undo import from 2026-10-20T12:00:00\.000Z"/u);
});

test('panel gates the private draft backup on explicit confirmation', async () => {
  const { deps } = setup();
  const controller = createImportsController(deps, PROJECT);
  controller.setExportChoice('draft-backup');
  const unconfirmed = render(controller.getState());
  assert.match(unconfirmed, /<input type="checkbox"\/>I understand this file contains private drafts/u);
  assert.match(unconfirmed, /<button type="button" disabled="">Create private draft backup<\/button>/u);
  controller.setConfirmPrivate(true);
  const confirmed = render(controller.getState());
  assert.match(confirmed, /<button type="button">Create private draft backup<\/button>/u);
  await controller.exportNow();
  const exported = render(controller.getState());
  assert.match(exported, /<dt>Digest<\/dt><dd><code>sha256:[0-9a-f]{64}<\/code><\/dd>/u);
  assert.match(exported, /workspace: workspace not in draft backup/u);
  assert.match(exported, /cache: cache excluded/u);
});
