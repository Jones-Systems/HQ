import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { AgentEvent } from '../src/contract.ts';
import { installPreviewAgent } from '../src/preview-agent/index.ts';
import { elementPath, locateQuote, quoteContext, textHash } from '../src/preview-agent/index.ts';
import { parseTarget } from '../src/validate.ts';
import { FakeWindow, buildPage } from './fake-dom.ts';

// Event routing over a FAKE DOM; real-browser geometry is in test/browser/.

function setup() {
  const win = new FakeWindow();
  const page = buildPage(win);
  const events: AgentEvent[] = [];
  const agent = installPreviewAgent(win as unknown as Window, { post: (event) => events.push(event) });
  return { win, page, events, agent };
}

describe('preview agent pure helpers', () => {
  test('elementPath is deterministic and prefers unique ids', () => {
    const { win, page } = setup();
    const unique = () => true;
    assert.equal(elementPath(page.save, unique), 'html > body > main > div > button:nth-of-type(1)');
    assert.equal(elementPath(page.cancel, unique), 'html > body > main > div > button:nth-of-type(2)');
    page.main.id = 'content';
    assert.equal(elementPath(page.cancel, unique), '#content > div > button:nth-of-type(2)');
    assert.equal(elementPath(page.cancel, () => false), 'html > body > main > div > button:nth-of-type(2)');
    page.main.id = 'has space';
    assert.equal(elementPath(page.cancel, unique), 'html > body > main > div > button:nth-of-type(2)');
    assert.equal(win.document.querySelector(elementPath(page.cancel, unique)), page.cancel);
  });

  test('locateQuote uses prefix/suffix to pick the right occurrence', () => {
    const text = 'Ship the plan. Review the plan today. Then the plan ships.';
    const second = text.indexOf('the plan', 10);
    const { prefix, suffix } = quoteContext(text, second, second + 'the plan'.length);
    assert.deepEqual(locateQuote(text, 'the plan', prefix, suffix), { start: second, end: second + 8 });
    assert.deepEqual(locateQuote(text, 'the plan', '', ''), { start: 5, end: 13 });
    assert.equal(locateQuote(text, 'absent', '', ''), null);
    // Survives an edit elsewhere on the page.
    const edited = `New banner. ${text}`;
    assert.deepEqual(locateQuote(edited, 'the plan', prefix, suffix), { start: second + 12, end: second + 20 });
  });

  test('textHash normalizes whitespace', () => {
    assert.equal(textHash('Save  \n changes'), textHash('Save changes'));
    assert.notEqual(textHash('Save'), textHash('Cancel'));
    assert.match(textHash(''), /^fnv1a32:[0-9a-f]{8}$/u);
  });
});

describe('preview agent modes', () => {
  test('off mode emits nothing and lets the page handle clicks', () => {
    const { win, page, events } = setup();
    win.selectText(page.introText, 15, 30);
    win.dispatch('click', page.save);
    win.dispatch('mouseup', page.intro);
    assert.deepEqual(events, []);
    assert.ok(win.pageHandled.includes('click'));
  });

  test('Pick emits only element picks, in document CSS px, and blocks page activation', () => {
    const { win, page, events, agent } = setup();
    agent.setMode('pick');
    win.scrollY = 300;
    win.devicePixelRatio = 2;
    win.selectText(page.introText, 15, 30);
    for (const type of ['pointerdown', 'mousedown', 'mouseup', 'keyup']) win.dispatch(type, page.save);
    const click = win.dispatch('click', page.save);
    assert.equal(click.defaultPrevented, true);
    assert.ok(!win.pageHandled.includes('click'), 'the page never sees a pick click');
    assert.equal(events.length, 1);
    const [event] = events;
    assert.equal(event?.type, 'element-picked');
    if (event?.type !== 'element-picked') return;
    assert.equal(event.target.path, 'html > body > main > div > button:nth-of-type(1)');
    assert.deepEqual(event.target.rect, { x: 20, y: 500, width: 80, height: 32 });
    assert.deepEqual(event.frame, { viewport: { w: 1280, h: 800, dpr: 2 }, scroll: { x: 0, y: 300 } });
    assert.deepEqual(parseTarget(event.target), event.target, 'emitted target is a valid persisted target');
  });

  test('Cite emits only text citations with context and lets clicks through', () => {
    const { win, page, events, agent } = setup();
    agent.setMode('cite');
    win.scrollY = 100;
    win.selectText(page.introText, 15, 30);
    win.dispatch('click', page.save);
    assert.ok(win.pageHandled.includes('click'));
    win.dispatch('mouseup', page.intro);
    assert.equal(events.length, 0, 'citations wait for the selection to settle');
    win.flushTimers();
    win.dispatch('mouseup', page.intro);
    win.flushTimers();
    assert.equal(events.length, 1, 'identical selection is reported once');
    const [event] = events;
    assert.equal(event?.type, 'text-cited');
    if (event?.type !== 'text-cited') return;
    assert.equal(event.target.quote, 'Review the plan');
    assert.equal(event.target.prefix, 'Ship the plan. ');
    assert.equal(event.target.suffix, ' today.SaveCancel');
    assert.deepEqual(event.target.rects, [{ x: 140, y: 200, width: 120, height: 16 }]);
    assert.deepEqual(parseTarget(event.target), event.target);
  });

  test('Cite ignores collapsed or blank selections', () => {
    const { win, page, events, agent } = setup();
    agent.setMode('cite');
    win.selectText(page.introText, 4, 4);
    win.dispatch('mouseup', page.intro);
    win.flushTimers();
    win.selectText(page.introText, 4, 5);
    win.dispatch('mouseup', page.intro);
    win.flushTimers();
    assert.deepEqual(events, []);
  });

  test('a multi-click reports only its final selection', () => {
    const { win, page, events, agent } = setup();
    agent.setMode('cite');
    win.selectText(page.introText, 24, 28);
    win.dispatch('mouseup', page.intro);
    win.dispatch('mousedown', page.intro);
    assert.equal(win.pendingTimers, 0, 'the next press cancels the pending citation');
    win.selectText(page.introText, 0, 37);
    win.dispatch('mouseup', page.intro);
    win.flushTimers();
    assert.equal(events.length, 1);
    assert.equal(events[0]?.type === 'text-cited' ? events[0].target.quote : null, 'Ship the plan. Review the plan today.');
  });

  test('quotes are trimmed and their rects follow the trimmed text', () => {
    const { win, page, events, agent } = setup();
    agent.setMode('cite');
    win.selectText(page.introText, 14, 31);
    win.dispatch('keyup', page.intro);
    win.flushTimers();
    const [event] = events;
    if (event?.type !== 'text-cited') throw new Error('expected a citation');
    assert.equal(event.target.quote, 'Review the plan');
    assert.equal(event.target.prefix, 'Ship the plan. ');
    assert.deepEqual(event.target.rects, [{ x: 140, y: 100, width: 120, height: 16 }]);
  });

  test('switching mode drops a pending citation', () => {
    const { win, page, events, agent } = setup();
    agent.setMode('cite');
    win.selectText(page.introText, 15, 30);
    win.dispatch('mouseup', page.intro);
    agent.setMode('pick');
    win.flushTimers();
    assert.deepEqual(events, []);
  });

  test('resolve re-finds elements and quotes in the current render', () => {
    const { win, page, agent } = setup();
    win.scrollY = 50;
    page.save.box = { left: 20, top: 10, width: 80, height: 32 };
    const resolution = agent.resolve([
      { kind: 'element', path: 'html > body > main > div > button:nth-of-type(1)' },
      { kind: 'element', path: 'html > body > aside' },
      { kind: 'element', path: '[[invalid' },
      { kind: 'text', quote: 'Review the plan', prefix: 'Ship the plan. ', suffix: ' today.' },
      { kind: 'text', quote: 'Not on page', prefix: '', suffix: '' },
    ]);
    assert.deepEqual(resolution.frame.scroll, { x: 0, y: 50 });
    assert.deepEqual(resolution.results[0], { found: true, rects: [{ x: 20, y: 60, width: 80, height: 32 }], textHash: textHash('Save') });
    assert.deepEqual(resolution.results[1], { found: false });
    assert.deepEqual(resolution.results[2], { found: false });
    assert.deepEqual(resolution.results[3], { found: true, rects: [{ x: 140, y: 150, width: 120, height: 16 }] });
    assert.deepEqual(resolution.results[4], { found: false });
  });

  test('a picked element whose path shifted is relocated only by a unique text hash', () => {
    const { win, page, agent } = setup();
    const path = 'html > body > main > div > button:nth-of-type(2)';
    // Structural re-render: a new div before the actions row shifts the path.
    const banner = win.document.createElement('div');
    page.main.childNodes.unshift(banner);
    banner.parentElement = page.main;
    banner.parentNode = page.main;
    const stale = 'html > body > main > div:nth-of-type(2) > button:nth-of-type(2)';
    assert.equal(win.document.querySelector(stale), page.cancel, 'fixture path now');
    const [withHash, withoutHash, wrongHash] = agent.resolve([
      { kind: 'element', path: 'html > body > main > div:nth-of-type(1) > button:nth-of-type(2)', textHash: textHash('Cancel') },
      { kind: 'element', path: 'html > body > main > div:nth-of-type(1) > button:nth-of-type(2)' },
      { kind: 'element', path: 'html > body > main > div:nth-of-type(1) > button:nth-of-type(2)', textHash: textHash('Nowhere') },
    ]).results;
    assert.deepEqual(withHash, { found: true, rects: [{ x: 110, y: 200, width: 80, height: 32 }], textHash: textHash('Cancel') });
    assert.deepEqual(withoutHash, { found: false });
    assert.deepEqual(wrongHash, { found: false });
    // Ambiguous hashes are never guessed.
    page.save.childNodes.splice(0, 1, Object.assign(page.save.childNodes[0]!, { data: 'Cancel' }));
    assert.deepEqual(agent.resolve([{ kind: 'element', path: path.replace('main >', 'main > div:nth-of-type(9) >'), textHash: textHash('Cancel') }]).results[0], { found: false });
  });

  test('dispose removes every listener and the highlight', () => {
    const { win, page, events, agent } = setup();
    const before = win.listenerCount();
    assert.ok(before > 0);
    agent.setMode('pick');
    win.dispatch('pointermove', page.save);
    assert.equal(win.document.documentElement.children.length, 2, 'highlight added');
    agent.dispose();
    assert.equal(win.listenerCount(), 0);
    assert.equal(win.document.documentElement.children.length, 1, 'highlight removed');
    win.dispatch('click', page.save);
    assert.deepEqual(events, []);
  });
});
