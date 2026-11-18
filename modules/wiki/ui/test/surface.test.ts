// The view reads through exactly the seven contract methods and never causes work, network or navigation by itself.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WIKI_SERVICE_METHODS, type WikiService } from '../../contract/src/index.ts';
import { createSyntheticService } from '../fixtures/synthetic.ts';
import { all, byText, click, one, submit, typeInto } from './render.ts';
import { launch, spy, trapEgress, validating } from './support.ts';

test('the injected service is exactly the seven read methods', () => {
  assert.deepEqual(Object.keys(createSyntheticService()).sort(), [...WIKI_SERVICE_METHODS].sort());
  assert.equal(WIKI_SERVICE_METHODS.length, 7);
});

/** A service that throws on any property that is not one of the seven. */
function sealed(base: WikiService): WikiService {
  return new Proxy(base, {
    get(target, property, receiver) {
      if (typeof property === 'string' && !(WIKI_SERVICE_METHODS as readonly string[]).includes(property)) {
        throw new Error(`The view reached for service.${property}`);
      }
      return Reflect.get(target, property, receiver);
    },
  });
}

async function walkthrough(service: WikiService, log: string[]): Promise<void> {
  const app = await launch({ service });
  const nav = (label: string | RegExp): HTMLElement => byText(app.container, '.wiki-nav button', label);
  await typeInto(one(app.container, 'input[name="q"]'), 'pricing');
  await submit(one(app.container, 'form'));
  await click(one(app.container, 'input[name="repository"][value="appdev"]'));
  await click(byText(app.container, '.wiki-hit-title', 'Pricing'));
  await click(byText(app.container, '.wiki-parsed button[data-target="ambiguous"]', 'Onboarding'));
  await click(all(app.container, '.wiki-candidates button')[0]!);
  await click(nav('Topics · BusinessLessons'));
  await click(nav('Topics · App Development'));
  await click(nav('← Back'));
  await click(nav('Forward →'));
  await click(nav(/^History/));
  await click(all(app.container, '.wiki-history li button')[0]!);
  await click(nav('Home'));
  log.push(...app.requested);
  await app.unmount();
}

test('a full walkthrough touches only the seven methods and requests only logical destinations', async () => {
  const egress = trapEgress();
  const { service, calls, touched } = spy(sealed(validating(createSyntheticService()).service));
  const requested: string[] = [];
  await walkthrough(service, requested);

  const seven = new Set<string>(WIKI_SERVICE_METHODS);
  assert.ok([...touched].every((name) => seven.has(name)), `touched: ${[...touched].join(', ')}`);
  assert.ok(calls.every((call) => seven.has(call.method)));
  assert.ok(new Set(calls.map((call) => call.method)).size >= 6, 'the walkthrough exercised most of the surface');
  assert.ok(requested.length > 5);
  for (const destination of requested) assert.match(destination, /^(home|page\/(bl|appdev)\/[^:]+|search\?q=[^&]+|topics\/(bl|appdev))$/, destination);
  assert.deepEqual(egress.calls, [], 'no fetch, XHR, WebSocket or window.open');
  egress.restore();
});

test('navigating and searching only read: every view-initiated destination is a request, nothing is dispatched elsewhere', async () => {
  const { service, calls } = spy();
  const seen: string[] = [];
  await walkthrough(service, seen);
  const names = new Set(calls.map((call) => call.method));
  for (const forbidden of ['refresh', 'reindex', 'fetch', 'pull', 'sync', 'write', 'execute', 'run', 'send', 'dispatch']) assert.equal(names.has(forbidden), false, forbidden);
  assert.equal(typeof (createSyntheticService() as unknown as Record<string, unknown>)['refresh'], 'undefined', 'refresh belongs to the host, not WikiService');
});

test('requests carry logical keys and queries only', async () => {
  const { service, calls } = spy();
  await walkthrough(service, []);
  const forbiddenKeys = ['root', 'ref', 'url', 'path', 'argv', 'cwd', 'commit', 'remote'];
  for (const call of calls) {
    const request = (call.args[0] ?? {}) as Record<string, unknown>;
    for (const key of forbiddenKeys) assert.equal(key in request, false, `${call.method} carried ${key}`);
  }
});
