import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { test } from 'vitest';
import { brandId } from '../../../connector/src/ids.ts';
import { ReferencesSection } from '../references/View.tsx';
import { createReferencesEnvironment } from '../references/env.ts';
import { RequestsSection } from '../requests/View.tsx';
import { RunsSection } from '../runs/View.tsx';
import { SIMULATION_LABEL } from '../runs/pipeline.ts';
import { compareSlot, sent } from './doubles.ts';

test('sections render simulated and owner-reported returns distinctly after restart', async () => {
  const { d, runs, session, packet, dispatchId } = await sent();
  await runs.pipeline.simulateReturn(session, dispatchId);
  await runs.pipeline.reportOwnerReturn(session, { packetId: packet.packetId, claims: ['Owner-reported result'] });
  const rebuilt = await d.open();
  const fresh = await rebuilt.requests.open(session.state.requestId);
  await rebuilt.runs.pipeline.selectPacket(fresh, packet.packetId);
  await rebuilt.runs.pipeline.refresh(fresh);
  const before = d.writes.length;
  const html = renderToStaticMarkup(<RequestsSection env={rebuilt.requests} session={fresh} />);
  assert.ok(html.includes(SIMULATION_LABEL));
  assert.ok(html.includes('1 simulated returns'));
  assert.ok(html.includes('1 owner-reported returns'));
  assert.ok(html.includes('0 natively verified returns'));
  assert.ok(html.includes('Owner-reported'));
  const runHtml = renderToStaticMarkup(<RunsSection env={rebuilt.runs} session={fresh} now={d.clock.now()} />);
  assert.ok(runHtml.includes(SIMULATION_LABEL));
  assert.ok(runHtml.includes('Simulation is not native verification'));
  assert.equal(d.writes.length, before, 'rendering cannot dispatch');
});

test('host and model variance is visible in both composed run surfaces', async () => {
  const { d, runs, session, dispatchId } = await sent();
  const stored = (await d.outbox.get(dispatchId))!;
  const attempt = stored.record.attempts[0]!;
  assert.ok(attempt.receipt);
  d.outbox.backing.set(dispatchId, {
    ...stored,
    record: { ...stored.record, attempts: [{
      ...attempt,
      receipt: {
        ...attempt.receipt, observedHostId: brandId('HostId', 'host.synthetic-variance'),
        observedModel: { provider: 'synthetic', model: 'variance-model' },
      },
      variances: ['host-mismatch', 'model-mismatch'],
    }] },
  });
  await runs.pipeline.refresh(session);
  const html = renderToStaticMarkup(<RunsSection env={runs} session={session} now={d.clock.now()} />);
  assert.ok(html.includes('host.synthetic-variance'));
  assert.ok(html.includes('variance-model'));
  assert.ok(html.includes('differs from the pin'));
  assert.equal(await runs.pipeline.simulateReturn(session, dispatchId), null, 'mismatched evidence cannot enter inbox');
});

test('references compose both panels with injected previews and do not create blob URLs', async () => {
  const { d } = await sent();
  const env = await createReferencesEnvironment({
    storage: d.referenceStorage, clock: d.clock, ids: d.ids, compareSlot, previewUrl: () => null,
  });
  const html = renderToStaticMarkup(<ReferencesSection env={env} currentProject={{ id: 'synthetic-project', name: 'Synthetic' }} />);
  assert.ok(html.includes('References'));
  assert.ok(!html.includes('blob:'));
  const injected = await createReferencesEnvironment({
    storage: d.referenceStorage, clock: d.clock, ids: d.ids, compareSlot,
    previewUrl: () => 'data:image/png;base64,c3ludGhldGlj',
  });
  assert.equal(injected.previewUrl('synthetic' as never), 'data:image/png;base64,c3ludGhldGlj');
});
