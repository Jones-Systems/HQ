import { Fragment, use, useMemo, useState } from 'react';
import { Button } from '@hq/ui';
import type { DesignSectionProps } from '../../../ui/contract.ts';
import type { ProjectContent } from '../../../projects/src/content.ts';
import { projectId, projectVersionSubject, type TasteClientPort } from '../../../taste/src/contract.ts';
import { TastePanel } from '../../../taste/src/ui/TastePanel.tsx';
import { PREVIEW_PROJECT, PREVIEW_SUBJECT } from '../../../taste/preview/fake-client.ts';
import type { DesignFeedback } from '../errors.ts';
import { FAKE_TAG, SYNTHETIC_TAG } from '../labels.ts';
import { reportTasteFailures, type TasteOperation } from '../taste-failures.ts';
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

type TasteNotices = Readonly<Partial<Record<TasteOperation, DesignFeedback>>>;

function TasteSelection({ context, content, client }: {
  context: DesignSectionProps['context']; content: ProjectContent; client: TasteClientPort;
}) {
  const [selection, setSelection] = useState<{ client: TasteClientPort; versionId: string | null }>({ client, versionId: null });
  const [notices, setNotices] = useState<TasteNotices>({});
  // Reload remounts the panel, which reads the journal again.
  const [reads, setReads] = useState(0);
  // The wrapper is stable per client, so a replacement client still resets the panel.
  const reported = useMemo(() => reportTasteFailures(client, (operation, feedback) => setNotices((current) => {
    if (feedback === null && current[operation] === undefined) return current;
    const { [operation]: _replaced, ...rest } = current;
    return feedback === null ? rest : { ...rest, [operation]: feedback };
  })), [client]);
  // A replacement adapter must not inherit a subject selected against the previous client.
  if (selection.client !== client) {
    setSelection({ client, versionId: null });
    setNotices({});
    return null;
  }
  const version = content.versions.find((item) => item.id === selection.versionId);
  if (content.versions.length === 0) return <p role="status">No saved versions for this project yet.</p>;
  const recover = (kind: 'retry' | 'reload' | 'check' | 'choose-again') => {
    setNotices({});
    if (kind === 'choose-again') setSelection({ client, versionId: null });
    else setReads((count) => count + 1);
  };
  return <>
    <label>Version to rate
      <select value={version?.id ?? ''} onChange={(event) => setSelection({ client, versionId: event.target.value || null })}>
        <option value="">Choose a saved version</option>
        {content.versions.map((item) => <option key={item.id} value={item.id}>
          {content.views.find((view) => view.id === item.viewId)?.title} · {item.label} · {item.id}
        </option>)}
      </select>
    </label>
    {Object.values(notices).map((notice) => <TasteNotice key={notice.meta} notice={notice} onAction={recover} />)}
    {version ? <Fragment key={reads}>
      {/* Version IDs repeat across projects, so the subject is qualified with this project. */}
      <TastePanel client={reported} projectId={projectId(context.id)} projectName={context.name}
        subject={projectVersionSubject(projectId(context.id), version.id, version.label)} />
    </Fragment>
      : <p role="status">Choose a saved version to rate.</p>}
  </>;
}

/** The typed failure beside the panel. The panel keeps its own message and the user's input. */
function TasteNotice({ notice, onAction }: { notice: DesignFeedback; onAction: (kind: 'retry' | 'reload' | 'check' | 'choose-again') => void }) {
  return <div role={notice.persistent ? 'alert' : 'status'} data-tone={notice.tone} data-inline={notice.inline}>
    <p><strong>{notice.title}</strong>{notice.description === undefined ? null : ` ${notice.description}`}</p>
    <p><code>{notice.meta}</code></p>
    {notice.action ? <Button size="sm" onClick={() => onAction(notice.action!.kind)}>{notice.action.label}</Button> : null}
  </div>;
}

export const TasteView = withSectionErrorBoundary(TasteViewContent);
