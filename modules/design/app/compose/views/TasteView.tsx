import { use, useState } from 'react';
import type { DesignSectionProps } from '../../../ui/contract.ts';
import type { ProjectContent } from '../../../projects/src/content.ts';
import { projectId, subjectId, type TasteClientPort } from '../../../taste/src/contract.ts';
import { TastePanel } from '../../../taste/src/ui/TastePanel.tsx';
import { PREVIEW_PROJECT, PREVIEW_SUBJECT } from '../../../taste/preview/fake-client.ts';
import { FAKE_TAG, SYNTHETIC_TAG } from '../labels.ts';
import type { DesignWorkspace } from '../workspace.ts';
import { useDesignWorkspace } from '../workspace-context.tsx';
import { SectionFrame } from './SectionFrame.tsx';
import { withSectionErrorBoundary } from './SectionErrorBoundary.tsx';

function TasteViewContent({ context }: DesignSectionProps) {
  const workspace = useDesignWorkspace();
  if (workspace.bridged) return <BridgedTaste context={context} workspace={workspace} />;
  return <PreviewTaste workspace={workspace} />;
}

/** The labelled review client retains its in-memory fake journal and synthetic subject. */
function PreviewTaste({ workspace }: { workspace: Extract<DesignWorkspace, { bridged: false }> }) {
  const { client } = use(workspace.tasteEnv());
  return <SectionFrame lane="T7 taste" entry="taste/src/ui › TastePanel" tags={[FAKE_TAG, SYNTHETIC_TAG]}
    notes={['in-memory fake journal (not durable)', 'seeded for one synthetic project, not the shell project', 'automatic guidance and legacy reuse off']}>
    <TastePanel client={client} subject={PREVIEW_SUBJECT} projectId={PREVIEW_PROJECT} projectName="Synthetic taste project" />
  </SectionFrame>;
}

function BridgedTaste({ context, workspace }: {
  context: DesignSectionProps['context']; workspace: Extract<DesignWorkspace, { bridged: true }>;
}) {
  const { content } = use(workspace.contentFor(context));
  const { client } = use(workspace.tasteFor(context));
  return <SectionFrame lane="T7 taste" entry="taste/src/ui › TastePanel" tags={[workspace.storageTag]}>
    <TasteSelection key={context.id} context={context} content={content} client={client} />
  </SectionFrame>;
}

function TasteSelection({ context, content, client }: {
  context: DesignSectionProps['context']; content: ProjectContent; client: TasteClientPort;
}) {
  const [selection, setSelection] = useState<{ client: TasteClientPort; versionId: string | null }>({ client, versionId: null });
  // A replacement adapter must not inherit a subject selected against the previous client.
  if (selection.client !== client) {
    setSelection({ client, versionId: null });
    return null;
  }
  const version = content.versions.find((item) => item.id === selection.versionId);
  if (content.versions.length === 0) return <p role="status">No saved versions for this project yet.</p>;
  return <>
    <label>Version to rate
      <select value={version?.id ?? ''} onChange={(event) => setSelection({ client, versionId: event.target.value || null })}>
        <option value="">Choose a saved version</option>
        {content.versions.map((item) => <option key={item.id} value={item.id}>
          {content.views.find((view) => view.id === item.viewId)?.title} · {item.label} · {item.id}
        </option>)}
      </select>
    </label>
    {version ? <TastePanel client={client} projectId={projectId(context.id)} projectName={context.name}
      subject={{ id: subjectId(version.id), kind: 'version', label: version.label, versionId: version.id }} />
      : <p role="status">Choose a saved version to rate.</p>}
  </>;
}

export const TasteView = withSectionErrorBoundary(TasteViewContent);
