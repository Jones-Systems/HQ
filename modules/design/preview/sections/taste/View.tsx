import { use } from 'react';
import type { DesignSectionProps } from '../../../ui/contract.ts';
import { TastePanel } from '../../../taste/src/ui/TastePanel.tsx';
import { PREVIEW_PROJECT, PREVIEW_SUBJECT, createPreviewTaste } from '../../../taste/preview/fake-client.ts';
import { PreviewFrame } from '../../PreviewFrame.tsx';

// The lane's own review client: the real journal and service over an in-memory
// fake file system, seeded with synthetic ratings for one synthetic project.
let seed: ReturnType<typeof createPreviewTaste> | null = null;
const load = () => (seed ??= createPreviewTaste());

export function TastePreview(_props: DesignSectionProps) {
  const { client } = use(load());
  return <PreviewFrame lane="T7 taste" entry="taste/src/ui › TastePanel"
    notes={['in-memory fake journal (not durable)', 'seeded for one synthetic project, not the shell project', 'automatic guidance and legacy reuse off']}>
    <TastePanel client={client} subject={PREVIEW_SUBJECT} projectId={PREVIEW_PROJECT} projectName="Synthetic taste project" />
  </PreviewFrame>;
}
