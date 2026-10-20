import { ReferenceGraphPanel } from '../../../references/ui/ReferenceGraphPanel.tsx';
import { ReferenceLibraryPanel } from '../../../references/ui/ReferenceLibraryPanel.tsx';
import type { ProjectRef } from '../../../references/ui/view-model.ts';
import '../../../references/ui/references.css';
import type { ReferencesEnvironment } from './env.ts';

export function ReferencesSection({ env, currentProject }: {
  readonly env: ReferencesEnvironment;
  readonly currentProject: ProjectRef | null;
}) {
  return <section aria-label="References">
    <ReferenceLibraryPanel library={env.library} currentProject={currentProject} previewUrl={env.previewUrl} />
    <ReferenceGraphPanel graph={env.graph} currentProject={currentProject} />
  </section>;
}
