import { use } from 'react';
import type { DesignSectionProps } from '../../../ui/contract.ts';
import { TastePanel } from '../../../taste/src/ui/TastePanel.tsx';
import { PREVIEW_PROJECT, PREVIEW_SUBJECT } from '../../../taste/preview/fake-client.ts';
import { FAKE_TAG, SYNTHETIC_TAG } from '../labels.ts';
import { tasteEnv } from '../workspace.ts';
import { SectionFrame } from './SectionFrame.tsx';

/** The lane's own review client: the real journal and service over an in-memory fake file system. */
export function TasteView(_props: DesignSectionProps) {
  const { client } = use(tasteEnv());
  return <SectionFrame lane="T7 taste" entry="taste/src/ui › TastePanel" tags={[FAKE_TAG, SYNTHETIC_TAG]}
    notes={['in-memory fake journal (not durable)', 'seeded for one synthetic project, not the shell project', 'automatic guidance and legacy reuse off']}>
    <TastePanel client={client} subject={PREVIEW_SUBJECT} projectId={PREVIEW_PROJECT} projectName="Synthetic taste project" />
  </SectionFrame>;
}
