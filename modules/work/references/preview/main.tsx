import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { ReferenceEnvelope } from '@hq/contracts';
import type { ReferencePort } from '@hq/ui';
import { createFixturePlanner, createWorkStore, exampleItems, HQ_REFERENCES_FEATURE, useWorkState } from '../../core';
import { CardDetail, createDetailState } from '../../detail';
import { createFeedback } from '../../board/feedback';
import { WorkToasts } from '../../board/WorkToasts';
import { createWorkReferenceProvider } from '../provider';
import './preview.css';

// Synthetic in-memory source boundary only; this recorder does not implement shell navigation.
const projectId = 'synthetic-project';
const items = exampleItems('2026-10-21');
const target = items[1]!;
const envelope: ReferenceEnvelope = { version: 1, domain: 'work', projectId, kind: 'item', entityId: target.id,
  title: 'Earlier snapshot title', sourceRevision: '0', returnDestination: { domain: 'work', destination: `item/${target.id}` } };
items[0]!.references = [{ id: 'ref-synthetic', kind: 'hq', label: envelope.title, target: envelope }];
const fixture = createFixturePlanner({ items, features: [HQ_REFERENCES_FEATURE] });
const store = createWorkStore(fixture.port);
const feedback = createFeedback();
const detail = createDetailState();
const provider = createWorkReferenceProvider(projectId, fixture.port);
function Preview() {
  const state = useWorkState(store, { pollMs: 1e9 });
  const [opened, setOpened] = useState('None');
  const [references] = useState<ReferencePort>(() => ({ find: provider.find, resolve: provider.resolve,
    open: (value) => setOpened(value.entityId) }));
  return <main><h1>Synthetic Work references</h1><p>In-memory source fixture. No live persistence or execution. Cross-domain Back is shell/r3-owned.</p>
    <p>Open recorder: {opened}</p>
    <CardDetail store={store} state={state} feedback={feedback} detail={detail} itemId={items[0]!.id} projectId={projectId}
      references={references} onClose={() => {}} />
    <WorkToasts store={store} state={state} feedback={feedback} />
  </main>;
}
createRoot(document.getElementById('root')!).render(<Preview />);
