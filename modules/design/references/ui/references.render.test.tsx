/**
 * Rendered checks through React's actual runtime (react-dom/server markup).
 * They prove rendered structure and labels, not browser layout or Electron capture.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import type { ReferenceId } from '../src/contract.ts';
import { fakePorts } from '../src/fakes.ts';
import { ReferenceLibrary } from '../src/service.ts';
import { appScreenshot, nativeReference, screenshot } from '../test/fixtures.ts';
import { ReferenceLibraryPanel } from './ReferenceLibraryPanel.tsx';
import { ReferenceLibraryView } from './ReferenceLibraryView.tsx';
import { buildLibraryView } from './view-model.ts';
import { createReferencesEnvironment } from '../../app/sections/references/env.ts';
import { ReferencesSection } from '../../app/sections/references/View.tsx';

const noop = () => undefined;
const actions = {
  onQueryChange: noop, onSelectCollection: noop, onSelectReference: noop, onCreateCollection: noop,
  onDeleteCollection: noop, onUseInProject: noop, onReload: noop,
};

async function seeded() {
  const library = await ReferenceLibrary.open(fakePorts());
  const ids: ReferenceId[] = [];
  for (const candidate of [
    screenshot({ rights: { status: 'permitted', basis: 'Synthetic CC0' } }),
    appScreenshot(),
    nativeReference(),
  ]) ids.push((await library.importReference(candidate) as { id: ReferenceId }).id);
  return { library, ids };
}

describe('ReferenceLibraryView rendered markup', () => {
  test('an empty library offers real image selection and project folders without empty sidebars or graph', async () => {
    const ports = fakePorts();
    const env = await createReferencesEnvironment({ storage: ports.storage, clock: ports.clock,
      ids: { label: 'fake:ids', next: (kind) => `${kind}_test` }, compareSlot: () => null, previewUrl: () => null });
    const html = renderToStaticMarkup(<ReferencesSection env={env} currentProject={null} onShowProjects={noop} />);
    expect(html).toContain('Bring in designs to compare');
    expect(html).toContain('Import screenshots');
    expect(html).toContain('Show my project folders');
    expect(html).toMatch(/<input[^>]+type="file"[^>]+accept="image\/png,image\/jpeg,image\/webp"/u);
    expect(html).not.toContain('Reference graph');
    expect(html).not.toContain('New collection');
    expect(html).not.toContain('Reference collections');
    expect(html).not.toContain('tag:x');
  });

  test('cards show evidence, rights and use-in-project controls', async () => {
    const { library, ids } = await seeded();
    await library.useInProject(ids[0]!, 'project-alpha');
    const view = buildLibraryView(library.state, library.access, { query: '', collectionId: null, selectedId: ids[1]! }, { id: 'project-alpha', name: 'Alpha' });
    const html = renderToStaticMarkup(<ReferenceLibraryView view={view} previewUrl={(digest) => `hq-preview://${digest}`} {...actions} />);
    expect(html).toContain('Screenshot of iOS app');
    expect(html).toContain('Static image — not native execution');
    expect(html).toContain('Native iOS on device');
    expect(html).toContain('Publishable');
    expect(html).toContain('Rights unknown');
    expect(html).toContain('Used in Alpha');
    expect(html).toContain('Use in Alpha');
    expect(html).toMatch(/<img[^>]+loading="lazy"/u);
    expect(html).toContain('aria-label="Reference details"');
    // Exactly one card is marked selected, and the native card has no image.
    expect(html.match(/aria-current="true"/gu)?.length).toBe(1);
    expect(html).toContain('No image');
  });

  test('search and import share the header and linked references expose a state instead of an action', async () => {
    const { library, ids } = await seeded();
    await library.useInProject(ids[0]!, 'project-alpha');
    const view = buildLibraryView(library.state, library.access,
      { query: '', collectionId: null, selectedId: null }, { id: 'project-alpha', name: 'Alpha' });
    const html = renderToStaticMarkup(<ReferenceLibraryView view={view} previewUrl={() => null}
      importControls={<button type="button">Import screenshots</button>} {...actions} />);
    const header = html.match(/<header[^>]*>(.*?)<\/header>/u)?.[1] ?? '';
    expect(header).toContain('Search references');
    expect(header).toContain('Import screenshots');
    expect(header).toMatch(/<label[^>]*class="hq-sr-only"[^>]*>Search references<\/label>/u);
    expect(html).toContain('3 shown');
    expect(html).toMatch(/<b[^>]*>Used in Alpha<\/b>/u);
    expect(html).not.toMatch(/<button[^>]*>Used in Alpha<\/button>/u);
  });

  test('long source text remains complete in details with every supplied provenance row', async () => {
    const library = await ReferenceLibrary.open(fakePorts());
    const screen = `Synthetic editor ${'long source description '.repeat(8)}${'a'.repeat(40)}`;
    const result = await library.importReference(appScreenshot({
      source: { kind: 'app', platform: 'ios', appId: 'com.example.notes', appName: 'Example Notes', screen },
      rights: { status: 'permitted', basis: 'Synthetic CC0', attribution: 'Example contributor' },
    }));
    const id = (result as { id: ReferenceId }).id;
    const view = buildLibraryView(library.state, library.access,
      { query: '', collectionId: null, selectedId: id }, null);
    const html = renderToStaticMarkup(<ReferenceLibraryView view={view} previewUrl={() => null} {...actions} />);
    const detail = html.match(/<aside[^>]*aria-label="Reference details"[^>]*>(.*?)<\/aside>/u)?.[1] ?? '';
    expect(detail).toContain('<h4>Provenance</h4>');
    expect(detail).toContain(screen);
    for (const row of view.detail!.provenance) {
      expect(detail).toContain(`<dt>${row.term}</dt>`);
      expect(detail).toContain(`<dd>${row.value}</dd>`);
    }
    expect(detail).toMatch(/<h3[^>]*tabindex="-1"/u);
    expect(detail).toContain('aria-label="Close reference details"');
    expect(html).toContain(`title="${view.cards[0]!.sourceLabel}"`);
  });

  test('without a project, use-in-project is disabled; banner explains read-only state', async () => {
    const { library } = await seeded();
    const view = buildLibraryView(library.state, { mode: 'read-only', reason: 'future-schema', detail: 'hq.design.references/v2' },
      { query: '', collectionId: null, selectedId: null }, null);
    const html = renderToStaticMarkup(<ReferenceLibraryView view={view} previewUrl={() => null} {...actions} />);
    expect(html).toContain('Open a project to use');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Open a project to use/u);
    expect(html).toContain('newer HQ version');
    expect(html).not.toContain('New collection');
    expect(html).toContain('Preview unavailable');
  });

  test('panel renders the service state through useSyncExternalStore', async () => {
    const { library } = await seeded();
    const html = renderToStaticMarkup(<ReferenceLibraryPanel library={library} currentProject={null} previewUrl={() => null} />);
    expect(html).toContain('3 references');
    expect(html).toContain('All references');
    expect(html).toContain('New collection');
  });
});
