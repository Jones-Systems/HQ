import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createContext, runInContext } from 'node:vm';
import { fileURLToPath } from 'node:url';
import { installPreviewAgentHost, textHash } from '../src/preview-agent/index.ts';
import { FakeElement, FakeText, FakeWindow, buildPage } from './fake-dom.ts';

// Labelled fake DOM only: records are injected, geometry is synthetic.
function setup() {
  const win = new FakeWindow();
  const page = buildPage(win);
  const host = installPreviewAgentHost(win as unknown as Window);
  return { win, page, host, agent: host.agent, observer: win.observers[0]! };
}

test('untrusted pick/cite events have no agent effect', () => {
  const { win, page, host, agent } = setup();
  agent.setMode('pick', 10);
  for (const type of ['pointermove', 'pointerdown', 'mousedown', 'mouseup', 'click', 'dblclick', 'auxclick']) {
    const event = win.dispatch(type, page.save, false);
    assert.equal(event.defaultPrevented, false);
  }
  assert.equal(win.document.documentElement.children.length, 1);
  assert.deepEqual(host.drain(), []);
  agent.setMode('cite', 11);
  win.selectText(page.introText, 15, 30);
  win.dispatch('mouseup', page.intro, false);
  win.dispatch('keyup', page.intro, false);
  assert.equal(win.pendingTimers, 0);
  win.flushTimers();
  assert.deepEqual(host.drain(), []);
});

test('every queued event retains its mode generation and pending citations cannot cross it', () => {
  const { win, page, host, agent } = setup();
  agent.setMode('pick', 5);
  win.dispatch('click', page.save);
  agent.setMode('cite', 6);
  win.selectText(page.introText, 15, 30);
  win.dispatch('mouseup', page.intro);
  agent.setMode('cite', 7);
  win.flushTimers();
  win.dispatch('keyup', page.intro);
  win.flushTimers();
  agent.setMode('off', 8);
  assert.deepEqual(host.drain().map((event) => [event.type, event.generation]), [
    ['element-picked', 5], ['text-cited', 7],
  ]);
  assert.throws(() => agent.setMode('pick', 2), /generation/);
  assert.throws(() => agent.setMode('pick', NaN), /generation/);
  agent.setMode('pick');
  assert.equal(agent.generation, 9);
});

test('isolated host is idempotent and queue drops oldest above 64 with cumulative count', () => {
  const { win, page, host, agent, observer } = setup();
  const count = win.listenerCount();
  assert.equal(installPreviewAgentHost(win as unknown as Window), host);
  assert.equal(win.listenerCount(), count);
  for (let generation = 1; generation <= 70; generation += 1) {
    agent.setMode('pick', generation);
    win.dispatch('click', page.save);
  }
  assert.equal(host.size, 64);
  assert.equal(host.dropped, 6);
  assert.deepEqual(host.drain().map((event) => event.generation), Array.from({ length: 64 }, (_, i) => i + 7));
  assert.equal(host.size, 0);
  assert.equal(host.dropped, 6);
  assert.deepEqual(host.drain(), []);
  host.dispose();
  assert.equal(win.listenerCount(), 0);
  assert.equal(observer.disconnected, true);
  assert.throws(() => agent.setMode('pick'), /disposed/);
  assert.notEqual(installPreviewAgentHost(win as unknown as Window), host);
});

test('subframes are refused before listeners or observers are installed', () => {
  const win = new FakeWindow();
  win.top = new FakeWindow();
  assert.throws(() => installPreviewAgentHost(win as unknown as Window), /main frame/);
  assert.equal(win.listenerCount(), 0);
  assert.equal(win.observers.length, 0);
});

test('takeRecords synchronously counts pending records once and excludes only owned highlight changes', () => {
  const { win, page, agent, observer } = setup();
  assert.deepEqual(observer.options, { subtree: true, childList: true, attributes: true, characterData: true });
  observer.enqueue(page.introText);
  observer.enqueue(page.save, 'attributes');
  assert.equal(agent.mutationCounter(), 2);
  observer.deliver();
  assert.equal(agent.mutationCounter(), 2);
  observer.enqueue(page.main, 'childList', [], [page.save]);
  observer.deliver();
  assert.equal(agent.mutationCounter(), 3);
  agent.setMode('pick');
  win.dispatch('pointermove', page.save);
  const highlight = win.document.documentElement.children[1]!;
  observer.enqueue(win.document.documentElement, 'childList', [highlight]);
  observer.enqueue(highlight, 'attributes');
  assert.equal(agent.mutationCounter(), 3);
  observer.enqueue(win.document.documentElement, 'childList', [highlight, page.save]);
  observer.enqueue(page.cancel, 'attributes');
  assert.equal(agent.resolveExact([]).mutationCounter, 5);
  assert.equal(agent.mutationCounter(), 5);
});

test('highlight hides throughout capture and restores current visibility', () => {
  const { win, page, agent } = setup();
  agent.setMode('pick');
  win.dispatch('pointermove', page.save);
  const highlight = win.document.documentElement.children[1]!;
  assert.equal(highlight.style.display, 'block');
  agent.setHighlightHidden(true);
  win.dispatch('pointermove', page.cancel);
  assert.equal(highlight.style.display, 'none');
  agent.setHighlightHidden(false);
  assert.equal(highlight.style.display, 'block');
  agent.setHighlightHidden(true);
  agent.setMode('off');
  agent.setHighlightHidden(false);
  assert.equal(highlight.style.display, 'none');
});

test('one exact read returns event identity, full text, rects, generation, frame and mutation counter', () => {
  const { win, page, agent, host, observer } = setup();
  agent.setMode('pick', 3);
  win.scrollY = 100;
  win.dispatch('click', page.save);
  const event = host.drain()[0]!;
  assert.equal(event.type, 'element-picked');
  if (event.type !== 'element-picked') return;
  observer.enqueue(page.introText);
  const request = { ...event.target, identity: event.snapshot.identity };
  const read = agent.resolveExact([request]);
  assert.equal(read.generation, 3);
  assert.equal(read.mutationCounter, 1);
  assert.deepEqual(read.frame, event.frame);
  assert.deepEqual(read.results, [{ found: true, ...event.snapshot }]);
  assert.deepEqual(event.snapshot.rects, [event.target.rect]);
  assert.equal(event.snapshot.text, 'Save');
  (page.save.childNodes[0] as FakeText).data = 'S ave';
  const changed = agent.resolveExact([{ kind: 'element', path: event.target.path }]).results[0]!;
  assert.equal(changed.found && changed.text, 'S ave');
  assert.deepEqual(agent.resolveExact([request]).results, [{ found: false }]);
  (page.save.childNodes[0] as FakeText).data = 'Save';
  const replacement = new FakeElement('button');
  replacement.appendChild(new FakeText('Save'));
  replacement.box = page.save.box;
  const parent = page.save.parentElement!;
  page.save.remove();
  parent.childNodes.unshift(replacement);
  replacement.parentElement = parent;
  replacement.parentNode = parent;
  assert.deepEqual(agent.resolveExact([request]).results, [{ found: false }]);
  assert.throws(() => agent.resolveExact(Array.from({ length: 51 }, () => request)), /50/);
});

test('exact element reads never relocate by hash or accept ambiguous paths', () => {
  const { agent } = setup();
  assert.deepEqual(agent.resolveExact([
    { kind: 'element', path: 'button' },
    { kind: 'element', path: '[[invalid' },
    { kind: 'element', path: 'aside', textHash: textHash('Save') },
  ]).results, [{ found: false }, { found: false }, { found: false }]);
});

test('exact text reads bind all selected nodes and offsets; reject changed context and replacement', () => {
  const { win, page, agent, host } = setup();
  agent.setMode('cite', 4);
  win.selectText(page.introText, 15, 30);
  win.dispatch('mouseup', page.intro);
  win.flushTimers();
  const event = host.drain()[0]!;
  if (event.type !== 'text-cited') throw new Error('expected citation');
  const request = { ...event.target, identity: event.snapshot.identity };
  assert.deepEqual(agent.resolveExact([request]).results, [{ found: true, ...event.snapshot }]);
  assert.equal(event.snapshot.text, 'Review the plan');
  assert.deepEqual(event.snapshot.rects, event.target.rects);
  page.introText.data = page.introText.data.replace('Ship', 'Send');
  assert.deepEqual(agent.resolveExact([request]).results, [{ found: false }]);
  page.introText.data = page.introText.data.replace('Send', 'Ship');
  const replacement = new FakeText(page.introText.data);
  replacement.box = page.introText.box;
  replacement.parentNode = page.intro;
  page.intro.childNodes.splice(0, 1, replacement);
  assert.deepEqual(agent.resolveExact([request]).results, [{ found: false }]);
  assert.deepEqual(agent.resolveExact([{ kind: 'text', quote: 'the plan', prefix: '', suffix: '' }]).results, [{ found: false }]);
});

test('captured intrinsic geometry ignores tampered instance and later prototype methods', () => {
  const { win, page, agent, host } = setup();
  const original = FakeElement.prototype.getBoundingClientRect;
  const tampered = () => { throw new Error('page override must not run'); };
  page.save.getBoundingClientRect = tampered;
  FakeElement.prototype.getBoundingClientRect = tampered;
  try {
    agent.setMode('pick');
    win.dispatch('pointermove', page.save);
    win.dispatch('click', page.save);
    const event = host.drain()[0]!;
    if (event.type !== 'element-picked') throw new Error('expected pick');
    assert.deepEqual(event.target.rect, { x: 20, y: 200, width: 80, height: 32 });
    assert.deepEqual(agent.resolveExact([event.target]).results, [{ found: true, ...event.snapshot }]);
  } finally {
    FakeElement.prototype.getBoundingClientRect = original;
  }
});

test('exact text identity includes intermediate nodes in a multi-node citation', () => {
  const { win, page, agent, host } = setup();
  const middle = page.intro.appendChild(new FakeText('middle'));
  const end = page.intro.appendChild(new FakeText('end'));
  const range = win.document.createRange();
  range.setStart(page.introText, 15);
  range.setEnd(end, 3);
  win.selection = { isCollapsed: false, rangeCount: 1, getRangeAt: () => range };
  agent.setMode('cite');
  win.dispatch('mouseup', page.intro);
  win.flushTimers();
  const event = host.drain()[0]!;
  if (event.type !== 'text-cited') throw new Error('expected citation');
  const request = { ...event.target, identity: event.snapshot.identity };
  assert.deepEqual(agent.resolveExact([request]).results, [{ found: true, ...event.snapshot }]);
  const replacement = new FakeText(middle.data);
  replacement.parentNode = page.intro;
  page.intro.childNodes.splice(1, 1, replacement);
  assert.deepEqual(agent.resolveExact([request]).results, [{ found: false }]);
});

test('full exact text reveals changes hidden by the legacy normalized, truncated hash', () => {
  const { win, page, agent, host } = setup();
  const text = page.save.childNodes[0] as FakeText;
  text.data = 'a'.repeat(4096) + 'before';
  agent.setMode('pick');
  win.dispatch('click', page.save);
  const event = host.drain()[0]!;
  if (event.type !== 'element-picked') throw new Error('expected pick');
  text.data = 'a'.repeat(4096) + 'after!';
  assert.equal(textHash(text.data), event.target.textHash);
  const result = agent.resolveExact([event.target]).results[0]!;
  assert.ok(result.found);
  assert.notEqual(result.text, event.snapshot.text);
  assert.equal(result.identity, event.snapshot.identity);
  page.save.box.top += 10;
  const moved = agent.resolveExact([event.target]).results[0]!;
  assert.ok(moved.found);
  assert.notDeepEqual(moved.rects, result.rects);
});

test('entry bundles as an in-memory IIFE and re-injection reuses the isolated host', async () => {
  const { build } = await import('vite');
  const output = await build({
    configFile: false,
    logLevel: 'silent',
    build: {
      write: false,
      minify: false,
      lib: { entry: fileURLToPath(new URL('../src/preview-agent/index.ts', import.meta.url)), name: 'HQPreviewAgent', formats: ['iife'] },
    },
  });
  const bundles = Array.isArray(output) ? output : [output];
  assert.equal(bundles.length, 1);
  const bundle = bundles[0]!;
  assert.ok('output' in bundle);
  const chunk = bundle.output.find((item) => item.type === 'chunk');
  assert.ok(chunk);
  const win = new FakeWindow();
  buildPage(win);
  const context = createContext({ win });
  runInContext(chunk.code, context);
  const first = runInContext('HQPreviewAgent.installPreviewAgentHost(win)', context);
  runInContext(chunk.code, context);
  assert.equal(runInContext('HQPreviewAgent.installPreviewAgentHost(win)', context), first);
  assert.equal(win.observers.length, 1);
  first.dispose();
});
