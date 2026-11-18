import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createImportsController } from '../src/controller.ts';
import { ImportsView } from '../src/ImportsPanel.ts';
import { PROJECT, setup } from './fixtures.ts';

test('picker typed failure retains its cause and description beside the Choose action', async () => {
  const { deps } = setup();
  const cause = Object.assign(new Error('Picker unavailable'), { description: 'Choose files again after reconnecting.' });
  const controller = createImportsController(deps, PROJECT, { pickSource: async () => { throw cause; } });
  await controller.choose();
  assert.equal(controller.getState().cause, cause);
  const html = renderToStaticMarkup(createElement(ImportsView, { state: controller.getState(), actions: {
    choose() {}, apply() {}, undo: async () => {}, resolve: async () => {}, setExportChoice() {}, setConfirmPrivate() {}, exportNow() {},
  } }));
  assert.match(html, /Picker unavailable/);
  assert.match(html, /Choose files again after reconnecting/);
});
