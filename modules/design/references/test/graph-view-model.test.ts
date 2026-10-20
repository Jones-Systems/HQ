/** Pure view model for the graph browser: labels, availability states, selection and read-only banners. */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { BlobDigest } from '../src/contract.ts';
import { deriveSubjectId } from '../src/graph-identity.ts';
import { capturesOfSubject } from '../src/graph-ops.ts';
import { buildGraphView } from '../ui/graph-view-model.ts';
import { appTree, openGraph, pageCapture, PERMITTED, websiteTree } from './graph-fixtures.ts';

const none = { subjectId: null, captureId: null } as const;
const project = { id: 'proj_a', name: 'Alpha' };

describe('graph view model', () => {
  test('rows are indented by hierarchy and show one of five availability texts', async () => {
    const { graph } = await openGraph();
    const missing = `sha256:${'a'.repeat(64)}` as BlobDigest;
    await graph.importTree(websiteTree({
      pages: [
        { url: 'https://example.com/ok', title: 'Fine', captures: [pageCapture('ok')] },
        { url: 'https://example.com/none', title: 'None', captures: [{ kind: 'screenshot', capturedAt: '2026-02-01T10:00:00.000Z', capturedBy: 'observed', captureKey: 'k' }] },
        { url: 'https://example.com/blob', title: 'Blob', captures: [{ kind: 'screenshot', capturedAt: '2026-02-01T10:00:00.000Z', capturedBy: 'observed', asset: { digest: missing, byteLength: 4, mediaType: 'image/png' } }] },
        { url: 'https://example.com/down', title: 'Down', captures: [pageCapture('down', { sourceStatus: 'source-unavailable' })] },
        { url: 'https://example.com/gone', title: 'Gone', captures: [pageCapture('gone', { sourceStatus: 'missing-at-source' })] },
      ],
    }));
    const view = buildGraphView(graph.state, graph.access, none, project);
    assert.equal(view.rows[0]!.depth, 0);
    assert.ok(view.rows.slice(1).every((row) => row.depth === 1));
    const text = Object.fromEntries(view.rows.map((row) => [row.title, row.availability?.text ?? null]));
    assert.deepEqual(text, {
      'Example Co': null,
      Blob: 'Image file missing from storage', Down: 'Source could not be reached', Fine: 'Image stored',
      Gone: 'Gone at source — stored copy kept', None: 'No image captured',
    });
    assert.equal(new Set(Object.values(text).filter(Boolean)).size, 5);
  });

  test('a selected subject lists captures newest first with rights, evidence and pin state', async () => {
    const { graph } = await openGraph();
    await graph.importTree(appTree({
      screens: [{ key: 'list', title: 'List', captures: [
        pageCapture('old', { capturedAt: '2026-01-01T00:00:00.000Z', rights: PERMITTED }),
        pageCapture('new', { capturedAt: '2026-02-01T00:00:00.000Z' }),
      ] }],
      flows: [],
    }));
    const subjectId = await deriveSubjectId({ kind: 'screen', app: await deriveSubjectId({ kind: 'app', platform: 'ios', appId: 'com.example.notes' }), key: 'list' });
    const [old] = capturesOfSubject(graph.state, subjectId);
    await graph.pin(old!.id, 'proj_a');
    const view = buildGraphView(graph.state, graph.access, { subjectId, captureId: null }, project);
    const detail = view.detail!;
    assert.deepEqual(detail.captures.map((capture) => capture.isLatest), [true, false]);
    assert.deepEqual(detail.captures.map((capture) => capture.rights.label), ['Rights unknown', 'Publishable']);
    assert.deepEqual(detail.captures.map((capture) => capture.pinnedInCurrentProject), [false, true]);
    assert.equal(detail.captures[0]!.evidenceLabel, 'Screenshot of iOS app');
    assert.equal(detail.captures[0]!.caveat, 'Static image — not native execution');
    assert.equal(detail.captures[0]!.selected, true, 'the latest capture is selected by default');
  });

  test('anchors of the selected capture are listed with their nesting', async () => {
    const { graph } = await openGraph();
    await graph.importTree(websiteTree());
    const subjectId = await deriveSubjectId({ kind: 'page', url: 'https://example.com/' });
    const view = buildGraphView(graph.state, graph.access, { subjectId, captureId: null }, null);
    assert.deepEqual(view.detail!.anchors.map((anchor) => [anchor.kindLabel, anchor.label, anchor.depth]).sort(), [
      ['Element', 'Primary call to action', 1], ['Section', 'Footer', 0], ['Section', 'Hero', 0],
    ]);
  });

  test('read-only and fenced states explain themselves and disable editing', async () => {
    const { graph } = await openGraph();
    const future = buildGraphView(graph.state, { mode: 'read-only', reason: 'future-schema', detail: 'hq.design.reference-graph/v2' }, none, null);
    assert.match(future.banner!, /newer HQ version/u);
    assert.equal(future.canEdit, false);
    assert.match(buildGraphView(graph.state, { mode: 'fenced', reason: 'unknown-write-effect' }, none, null).banner!, /may or may not have completed/u);
    assert.equal(buildGraphView(graph.state, graph.access, none, null).emptyMessage !== null, true);
  });
});
