import { ReferenceGraphPanel } from '../../../references/ui/ReferenceGraphPanel.tsx';
import { ReferenceLibraryPanel } from '../../../references/ui/ReferenceLibraryPanel.tsx';
import type { ProjectRef, ReferenceTasteSubject } from '../../../references/ui/view-model.ts';
import '../../../references/ui/references.css';
import type { ReferencesEnvironment } from './env.ts';
import { ScreenshotImport } from './ScreenshotImport.tsx';
import { useScreenshotImporter } from './use-screenshot-importer.ts';

export interface ReferencesSectionProps {
  readonly env: ReferencesEnvironment;
  readonly currentProject: ProjectRef | null;
  readonly onShowProjects?: () => void;
  /** "Rate taste" on a card, in the lightbox and on a save. The composed view decides where it goes. */
  readonly onSendToTaste?: (subject: ReferenceTasteSubject) => void;
  /** Ids of references already waiting for a Taste rating; their cards say so. */
  readonly queuedForTaste?: readonly string[];
  /** Where bulk import (bundles, recordings, HTML) lives. */
  readonly onOpenImports?: () => void;
}

export function ReferencesSection({ env, currentProject, onShowProjects, onSendToTaste, queuedForTaste, onOpenImports }: ReferencesSectionProps) {
  const importer = useScreenshotImporter(env, { onSendToTaste });
  return <section aria-label="References">
    <ReferenceLibraryPanel library={env.library} currentProject={currentProject} previewUrl={env.previewUrl} previewImage={env.previewImage}
      importControls={(disabled) => <ScreenshotImport importer={importer} disabled={disabled} onOpenImports={onOpenImports} />}
      onShowProjects={onShowProjects} onSendToTaste={onSendToTaste} queuedForTaste={queuedForTaste} onOpenImports={onOpenImports}
      onDropFiles={importer.addFiles} revealed={importer.revealed} />
    <ReferenceGraphPanel graph={env.graph} currentProject={currentProject} hideWhenEmpty />
  </section>;
}
