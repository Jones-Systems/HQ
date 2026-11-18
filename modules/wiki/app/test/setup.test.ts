// The mounted Wiki before it can show anything: with no repository configured it shows one set-up card that links to
// Settings, and when its host does not answer it shows one inline notice with Try again, never the views' error panels.
// Synthetic responses only.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { WIKI_SERVICE_METHODS, type IndexStatus, type SourceDescriptor, type WikiResult } from '../../contract/src/index.ts';
import { all, byText, click, mount, one, settle, textOf } from '../../ui/test/render.ts';
import { classifyWikiSetup } from '../../ui/src/index.ts';
import { createWikiDomain, type WikiDomainOptions } from '../src/domain.ts';
import type { WikiHostPort } from '../src/port.ts';
import { modulePort } from './harness.ts';

type Answer = () => unknown;
const EMPTY_SOURCES: Answer = () => ({ ok: true, value: [] });
const EMPTY_STATUS: Answer = () => ({ ok: true, value: { namespaces: [] } });
const SILENT: Answer = () => {
  throw new Error('synthetic: the host did not answer');
};

/** A bridge whose answers can be swapped between checks; it records every method the renderer called. */
function bridge(answers: { listSources: Answer; indexStatus: Answer }) {
  const calls: string[] = [];
  const port = Object.fromEntries(
    WIKI_SERVICE_METHODS.map((method) => [
      method,
      async () => {
        calls.push(method);
        const answer = (answers as Record<string, Answer | undefined>)[method];
        if (answer === undefined) throw new Error(`synthetic: ${method} is not expected`);
        return answer();
      },
    ]),
  ) as unknown as WikiHostPort;
  return { port, calls, answers };
}

async function launch(options: WikiDomainOptions) {
  const { Component } = createWikiDomain(options);
  const m = await mount(Component, modulePort());
  await settle();
  await settle();
  return m;
}

const descriptor = { namespace: 'bl' } as unknown as SourceDescriptor;
const answered = <T,>(value: T): WikiResult<T> => ({ ok: true, value });
const outage = { ok: false, error: { code: 'unavailable', reason: 'source-unavailable', message: 'The Wiki host did not answer.' } } as const;

describe('classifyWikiSetup', () => {
  test('an answered index status with no namespaces is not set up', () => {
    assert.deepEqual(classifyWikiSetup(answered<readonly SourceDescriptor[]>([]), answered<IndexStatus>({ namespaces: [] })), { kind: 'not-configured' });
    assert.deepEqual(classifyWikiSetup(outage, answered<IndexStatus>({ namespaces: [] })), { kind: 'not-configured' });
  });
  test('both reads unavailable is a silent host', () => {
    assert.deepEqual(classifyWikiSetup(outage, outage), { kind: 'unreachable', error: outage.error });
  });
  test('anything else is left to the views', () => {
    const entry = { namespace: 'bl', state: 'building', pageCount: 0, source: null } as const;
    assert.deepEqual(classifyWikiSetup(answered<readonly SourceDescriptor[]>([]), answered<IndexStatus>({ namespaces: [entry] })), { kind: 'ready' });
    assert.deepEqual(classifyWikiSetup(answered([descriptor]), answered<IndexStatus>({ namespaces: [] })), { kind: 'ready' });
    assert.deepEqual(classifyWikiSetup(answered<readonly SourceDescriptor[]>([]), outage), { kind: 'ready' });
    const rejected = { ok: false, error: { code: 'internal', reason: 'internal', message: 'synthetic' } } as const;
    assert.deepEqual(classifyWikiSetup(rejected, outage), { kind: 'ready' });
  });
});

describe('the mounted Wiki before set-up', () => {
  test('pending setup does not mount content or request topics before the status is answered', async () => {
    let answer: (value: unknown) => void = () => {};
    const pending = new Promise((resolve) => { answer = resolve; });
    const b = bridge({ listSources: EMPTY_SOURCES, indexStatus: () => pending });
    const { Component } = createWikiDomain({ getPort: () => b.port });
    const m = await mount(Component, modulePort());
    try {
      await settle();
      assert.match(textOf(one(m.container, '[role="status"]')), /Checking Wiki setup/);
      assert.deepEqual([...new Set(b.calls)].sort(), ['indexStatus', 'listSources']);
      answer(EMPTY_STATUS());
      await settle();
      assert.ok(one(m.container, '[data-wiki-setup="not-configured"]'));
      assert.deepEqual([...new Set(b.calls)].sort(), ['indexStatus', 'listSources']);
    } finally {
      answer(EMPTY_STATUS());
      await m.unmount();
    }
  });

  test('not configured: one set-up card whose Open Settings asks the shell, and no error panel', async () => {
    const b = bridge({ listSources: EMPTY_SOURCES, indexStatus: EMPTY_STATUS });
    const opened: string[] = [];
    const m = await launch({ getPort: () => b.port, openSettings: () => opened.push('wiki') });
    const card = one(m.container, '[data-wiki-setup="not-configured"]');
    assert.match(textOf(card), /Set up the Wiki/);
    assert.match(textOf(card), /Settings › Data sources › Local Wiki/);
    assert.equal(all(m.container, '.wiki-error, [role="alert"]').length, 0);
    assert.ok(one(m.container, '.wiki-view'), 'the card is styled by the Wiki stylesheet scope');
    await click(byText(card, 'button', 'Open Settings'));
    assert.deepEqual(opened, ['wiki']);
    assert.deepEqual(
      [...new Set(b.calls)].sort(),
      ['indexStatus', 'listSources'],
      'nothing but the two status reads is requested',
    );
    await m.unmount();
  });

  test('without a settings request the card still says where to set up, and offers no dead button', async () => {
    const b = bridge({ listSources: EMPTY_SOURCES, indexStatus: EMPTY_STATUS });
    const m = await launch({ getPort: () => b.port });
    const card = one(m.container, '[data-wiki-setup="not-configured"]');
    assert.match(textOf(card), /Settings › Data sources › Local Wiki/);
    assert.equal(all(card, 'button').filter((button) => textOf(button) === 'Open Settings').length, 0);
    await m.unmount();
  });

  test('Check again reads the status again', async () => {
    const b = bridge({ listSources: EMPTY_SOURCES, indexStatus: EMPTY_STATUS });
    const m = await launch({ getPort: () => b.port, openSettings: () => {} });
    const before = b.calls.filter((method) => method === 'indexStatus').length;
    b.answers.listSources = SILENT;
    b.answers.indexStatus = SILENT;
    await click(byText(m.container, 'button', 'Check again'));
    await settle();
    assert.equal(b.calls.filter((method) => method === 'indexStatus').length, before + 1);
    assert.ok(one(m.container, '[data-wiki-setup="unreachable"]'));
    await m.unmount();
  });

  test('host silent: one inline notice with Try again instead of error panels; recovery shows the next state', async () => {
    const b = bridge({ listSources: SILENT, indexStatus: SILENT });
    const m = await launch({ getPort: () => b.port, openSettings: () => {} });
    const notice = one(m.container, '[data-wiki-setup="unreachable"]');
    assert.equal(notice.getAttribute('role'), 'status');
    assert.match(textOf(notice), /Source unavailable/);
    assert.match(textOf(notice), /The Wiki host did not answer\./);
    assert.equal(all(m.container, '.wiki-error, [role="alert"]').length, 0);
    b.answers.listSources = EMPTY_SOURCES;
    b.answers.indexStatus = EMPTY_STATUS;
    await click(byText(notice, 'button', 'Try again'));
    await settle();
    assert.ok(one(m.container, '[data-wiki-setup="not-configured"]'));
    await m.unmount();
  });
});
