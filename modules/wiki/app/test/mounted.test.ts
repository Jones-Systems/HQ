// The assembled module in a DOM: the domain's Component, mounted the way the shell mounts it (a ModulePort), reading the
// synthetic committed-Git corpus through the real core behind the renderer client and a structured-clone bridge.
// happy-dom stands in for the renderer; the Electron shell and the installed app are not exercised here.

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { createElement, useState, type ReactElement } from 'react';
import { formatDestination } from '../../contract/src/index.ts';
import { dom } from '../../ui/test/dom.ts';
import { all, byText, click as clickOnce, mount, one, settle, submit as submitOnce, textOf, typeInto, type Mounted } from '../../ui/test/render.ts';
import { createWikiDomain } from '../src/domain.ts';
import type { WikiModulePort } from '../src/port.ts';
import { assemble, modulePort, type Assembly } from './harness.ts';

let a: Assembly;
before(async () => {
  a = await assemble('mounted');
});
after(() => a?.cleanup());

/** Real Git reads take real time: wait (bounded) until no request is loading, then once more for React to commit. */
async function idle(container: HTMLElement): Promise<void> {
  const deadline = Date.now() + 10_000;
  do {
    await settle();
  } while (container.querySelector('.wiki-loading') !== null && Date.now() < deadline);
  await settle();
}
const click = async (element: Element): Promise<void> => {
  await clickOnce(element);
  await idle(element.ownerDocument.body as unknown as HTMLElement);
};
const submit = async (form: Element): Promise<void> => {
  await submitOnce(form);
  await idle(form.ownerDocument.body as unknown as HTMLElement);
};

interface Launched {
  readonly m: Mounted<ShellProps>;
  readonly container: HTMLElement;
  readonly requested: string[];
}

interface ShellProps {
  readonly Module: WikiModulePort extends never ? never : (props: WikiModulePort) => ReactElement | null;
  readonly initial: string;
  readonly appearance: 'light' | 'dark';
  readonly log: string[];
}

/** A shell stand-in: holds the destination, persists what the module asks for (within 512 characters), passes a ModulePort. */
function Shell(props: ShellProps): ReactElement {
  const [destination, setDestination] = useState(props.initial);
  return createElement(
    props.Module,
    modulePort({
      destination,
      appearance: props.appearance,
      navigate: (requested) => {
        props.log.push(requested);
        if (requested.length <= 512) setDestination(requested);
      },
    }),
  );
}

async function launch(destination: string, appearance: 'light' | 'dark' = 'light', domain = a.domain): Promise<Launched> {
  const log: string[] = [];
  const m = await mount(Shell, { Module: domain.Component as ShellProps['Module'], initial: destination, appearance, log });
  await idle(m.container);
  return { m, container: m.container, requested: log };
}

describe('descriptor', () => {
  test('identity and presentation', () => {
    assert.equal(a.domain.id, 'wiki');
    assert.equal(a.domain.label, 'Wiki');
    assert.equal(a.domain.presentation, 'fill');
    assert.ok(Object.isFrozen(a.domain));
  });

  test('the Component is one stable identity across renders and wraps the view in the domain container', async () => {
    const first = a.domain.Component;
    const app = await launch('home');
    assert.equal(a.domain.Component, first);
    const wrapper = one(app.container, '.wiki-domain');
    assert.equal(wrapper.getAttribute('data-domain'), 'wiki');
    assert.equal(wrapper.children.length, 1);
    assert.ok(wrapper.firstElementChild?.classList.contains('wiki-view'));
    await app.m.unmount();
  });
});

describe('reading the synthetic corpus', () => {
  test('home lists both repositories at their pinned commits', async () => {
    const app = await launch('home');
    const text = textOf(app.container);
    assert.match(text, /BusinessLessons/);
    assert.match(text, /App Development/);
    assert.ok(text.includes(a.corpus.repos.bl.commit.slice(0, 12)));
    assert.ok(text.includes(a.corpus.repos.appdev.commit.slice(0, 12)));
    await app.m.unmount();
  });

  test('search from the box shows hits from both repositories and asks the shell to persist the destination', async () => {
    const app = await launch('home');
    await typeInto(one(app.container, 'input[name="q"]'), 'quokkaharbor');
    await submit(one(app.container, 'form[role="search"]'));
    assert.deepEqual(app.requested, ['search?q=quokkaharbor']);
    const hits = all(app.container, '.wiki-hit');
    assert.equal(hits.length, 2);
    assert.deepEqual(hits.map((hit) => textOf(one(hit, '.wiki-ns'))).sort(), ['App Development', 'BusinessLessons']);
    await app.m.unmount();
  });

  test('a page opens from search, shows backlinks, and its links navigate by logical destination', async () => {
    const app = await launch('search?q=quokkaharbor');
    await click(byText(app.container, '.wiki-hit button', 'Retry Policy'));
    assert.deepEqual(app.requested, ['page/bl/policies/retry-policy.md']);
    assert.equal(textOf(one(app.container, '.wiki-page-title')), 'Retry Policy');
    const backlinks = all(app.container, '.wiki-backlinks button').map((b) => textOf(b));
    assert.deepEqual(backlinks.map((text) => text.replace('BusinessLessons', ' · BusinessLessons')).sort(), ['Onboarding Guide · BusinessLessons', 'Synthetic Home · BusinessLessons']);
    await click(byText(app.container, '.wiki-backlinks button', /^Onboarding Guide/));
    assert.deepEqual(app.requested.at(-1), 'page/bl/guides/onboarding.md');
    assert.equal(textOf(one(app.container, '.wiki-page-title')), 'Onboarding Guide');
    await app.m.unmount();
  });

  test('a path with spaces and non-ASCII letters opens through its encoded destination', async () => {
    const formatted = formatDestination({ kind: 'page', key: { namespace: 'bl', path: 'notes/Ünï café & spaces.md' } });
    assert.ok(formatted.ok);
    const destination = formatted.value;
    assert.ok(!destination.includes(' ') && !destination.includes('&'));
    const app = await launch(destination);
    assert.equal(textOf(one(app.container, '.wiki-page-title')), 'Spaced Unicode Page');
    await app.m.unmount();
  });

  test('topics render each repository in its own mode', async () => {
    const app = await launch('topics/appdev');
    assert.match(textOf(one(app.container, '.wiki-topics')), /architecture/);
    await app.m.unmount();
  });

  test('a raw page shows its verbatim text and the reason', async () => {
    const app = await launch('page/bl/raw-frontmatter.md');
    assert.match(textOf(app.container), /frontmatter/i);
    assert.ok(one(app.container, '.wiki-raw-text').textContent?.includes('title: &anchor Raw Fixture'));
    await app.m.unmount();
  });

  test('hostile Markdown is inert: no script, image, link target or style reaches the DOM', async () => {
    (globalThis as Record<string, unknown>)['__wikiPwned'] = undefined;
    const app = await launch('page/bl/hostile/inert.md');
    assert.ok(textOf(app.container).includes('<script>window.__wikiPwned = true</script>'));
    assert.equal(all(app.container, 'script, img, iframe, object, embed, style, link').length, 0);
    assert.equal(all(app.container, 'a').length, 0, 'no anchors at all');
    assert.equal(all(app.container, '[href], [src], [srcdoc]').length, 0);
    assert.equal(all(app.container, '[style]').length, 0, 'no inline styles under the CSP');
    assert.equal(all(dom.document.head as unknown as ParentNode, 'style').length, 0);
    assert.equal((globalThis as Record<string, unknown>)['__wikiPwned'], undefined);
    const missing = all(one(app.container, '[data-content="parsed"]'), '.wiki-link-missing');
    assert.equal(missing.length, 1, 'the escaping link is shown as missing, not followed');
    await app.m.unmount();
  });

  test('appearance reaches the view and changes on re-render', async () => {
    const app = await launch('home', 'dark');
    assert.equal(one(app.container, '.wiki-view').getAttribute('data-appearance'), 'dark');
    await app.m.rerender({ Module: a.domain.Component as ShellProps['Module'], initial: 'home', appearance: 'light', log: app.requested });
    assert.equal(one(app.container, '.wiki-view').getAttribute('data-appearance'), 'light');
    await app.m.unmount();
  });

  test('the renderer only ever called the seven methods, with valid logical requests', () => {
    const names = new Set(a.bridge.calls.map((call) => call.method));
    for (const name of names) assert.ok((['listSources', 'search', 'getPage', 'resolveAlias', 'getBacklinks', 'listTopics', 'indexStatus'] as string[]).includes(name), name);
    for (const call of a.bridge.calls) {
      const text = JSON.stringify(call.args);
      assert.ok(!/gitDir|\/home\/|\.git\b|refs\/heads/.test(text), `no Git location in ${call.method} arguments`);
    }
  });
});

describe('without a bridge', () => {
  test('the module shows an unavailable state and does not throw', async () => {
    const down = createWikiDomain({ getPort: () => null });
    const app = await launch('home', 'light', down);
    assert.match(textOf(app.container), /unavailable/i);
    assert.ok(one(app.container, '.wiki-view'));
    await app.m.unmount();
  });
});
