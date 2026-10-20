/**
 * Rendered checks for the graph browser through React's actual runtime (react-dom/server markup).
 * They prove rendered structure and labels, not browser layout or Electron capture.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import { fakePorts } from '../src/fakes.ts';
import { deriveSubjectId } from '../src/graph-identity.ts';
import { ReferenceGraph } from '../src/graph-service.ts';
import { appTree, pageCapture, websiteTree } from '../test/graph-fixtures.ts';
import { ReferenceGraphPanel } from './ReferenceGraphPanel.tsx';
import { ReferenceGraphView } from './ReferenceGraphView.tsx';
import { buildGraphView } from './graph-view-model.ts';

const noop = () => undefined;
const actions = { onSelectSubject: noop, onSelectCapture: noop, onPinCapture: noop, onReload: noop };

async function seeded() {
  const ports = fakePorts();
  const graph = await ReferenceGraph.open({ storage: ports.storage, clock: ports.clock });
  await graph.importTree(websiteTree({
    pages: [
      ...websiteTree().pages,
      { url: 'https://example.com/gone', title: 'Retired offer', captures: [pageCapture('gone', { sourceStatus: 'missing-at-source' })] },
    ],
  }));
  await graph.importTree(appTree());
  return graph;
}

describe('ReferenceGraphView rendered markup', () => {
  test('the tree shows sites, pages, apps, flows and screens with distinct availability states', async () => {
    const graph = await seeded();
    const view = buildGraphView(graph.state, graph.access, { subjectId: null, captureId: null }, { id: 'proj_a', name: 'Alpha' });
    const html = renderToStaticMarkup(<ReferenceGraphView view={view} {...actions} />);
    for (const text of ['Example Co', 'Pricing', 'Example Notes', 'Create a note', 'Note list', 'Image stored', 'No image captured', 'Gone at source — stored copy kept']) {
      expect(html).toContain(text);
    }
    expect(html).toContain('aria-label="Sites, apps and their screens"');
    expect(html).not.toContain('Subject details');
  });

  test('a selected page shows captures, rights, anchors and a pin control for the open project', async () => {
    const graph = await seeded();
    const subjectId = await deriveSubjectId({ kind: 'page', url: 'https://example.com/' });
    const view = buildGraphView(graph.state, graph.access, { subjectId, captureId: null }, { id: 'proj_a', name: 'Alpha' });
    const html = renderToStaticMarkup(<ReferenceGraphView view={view} {...actions} />);
    expect(html).toContain('aria-label="Subject details"');
    expect(html).toContain('Captures, newest first');
    expect(html).toContain('Screenshot of website');
    expect(html).toContain('Rights unknown');
    expect(html).toContain('Pin this capture in Alpha');
    expect(html).toContain('Primary call to action');
    expect(html.match(/aria-current="true"/gu)?.length).toBe(2);
  });

  test('without a project the pin control is disabled, and a read-only banner explains why', async () => {
    const graph = await seeded();
    const subjectId = await deriveSubjectId({ kind: 'page', url: 'https://example.com/' });
    const view = buildGraphView(graph.state, { mode: 'read-only', reason: 'future-schema', detail: 'hq.design.reference-graph/v2' }, { subjectId, captureId: null }, null);
    const html = renderToStaticMarkup(<ReferenceGraphView view={view} {...actions} />);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Open a project to pin/u);
    expect(html).toContain('newer HQ version');
  });

  test('an empty graph says what will appear', async () => {
    const ports = fakePorts();
    const graph = await ReferenceGraph.open({ storage: ports.storage, clock: ports.clock });
    const html = renderToStaticMarkup(<ReferenceGraphPanel graph={graph} currentProject={null} />);
    expect(html).toContain('No sites or apps yet');
    expect(html).toContain('0 subjects');
  });
});
