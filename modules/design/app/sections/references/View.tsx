import { ReferenceGraphPanel } from '../../../references/ui/ReferenceGraphPanel.tsx';
import { ReferenceLibraryPanel } from '../../../references/ui/ReferenceLibraryPanel.tsx';
import type { ProjectRef } from '../../../references/ui/view-model.ts';
import '../../../references/ui/references.css';
import type { ReferencesEnvironment } from './env.ts';
import { ScreenshotImport } from './ScreenshotImport.tsx';

export function ReferencesSection({ env, currentProject, onShowProjects }: {
  readonly env: ReferencesEnvironment;
  readonly currentProject: ProjectRef | null;
  readonly onShowProjects?: () => void;
}) {
  return <section aria-label="References">
    <ReferenceLibraryPanel library={env.library} currentProject={currentProject} previewUrl={env.previewUrl} previewImage={env.previewImage}
      importControls={(disabled) => <ScreenshotImport env={env} disabled={disabled} />} onShowProjects={onShowProjects} />
    <ReferenceGraphPanel graph={env.graph} currentProject={currentProject} hideWhenEmpty />
  </section>;
}
