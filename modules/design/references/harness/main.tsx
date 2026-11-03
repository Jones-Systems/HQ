import { createRoot } from 'react-dom/client';
import { fakePorts } from '../src/fakes.ts';
import { ReferenceGraph } from '../src/graph-service.ts';
import { ReferenceGraphPanel } from '../ui/ReferenceGraphPanel.tsx';
import { appTree, pageCapture, websiteTree } from '../test/graph-fixtures.ts';
import './harness.css';

/** Review harness only: synthetic sites and apps over labelled in-memory fakes (not a real store). */
const ports = fakePorts();
const graph = await ReferenceGraph.open({ storage: ports.storage, clock: ports.clock });
await graph.importTree(websiteTree({
  pages: [
    ...websiteTree().pages,
    { url: 'https://example.com/retired', title: 'Retired offer', captures: [pageCapture('retired', { sourceStatus: 'missing-at-source' })] },
    { url: 'https://example.com/slow', title: 'Slow page', captures: [pageCapture('slow', { sourceStatus: 'source-unavailable' })] },
    {
      url: 'https://example.com/lost', title: 'Lost file',
      captures: [{ kind: 'screenshot', capturedAt: '2026-02-01T10:00:00.000Z', capturedBy: 'observed', asset: { digest: `sha256:${'a'.repeat(64)}`, byteLength: 4, mediaType: 'image/png' } }],
    },
  ],
}));
await graph.importTree(appTree());
// A later capture of the pricing page, so lineage and "latest" show.
await graph.importTree(websiteTree({ pages: [{ url: 'https://example.com/pricing', title: 'Pricing', captures: [pageCapture('pricing-v2', { capturedAt: '2026-03-01T10:00:00.000Z' })] }] }));
(window as unknown as { __graphHarness: unknown }).__graphHarness = { graph, label: ports.storage.label };

createRoot(document.getElementById('root')!).render(<ReferenceGraphPanel graph={graph} currentProject={{ id: 'proj_alpha', name: 'Alpha' }} />);
