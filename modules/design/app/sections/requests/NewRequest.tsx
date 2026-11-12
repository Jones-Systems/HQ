import { Button, InlineNotice } from '@hq/ui';
import { useState } from 'react';
import { GuardedButton } from '../../../requests/ui/GuardedButton.tsx';
import type { Loadable } from '../../../requests/ui/hooks.ts';
import { SourceVersionPicker, type SourceVersionChoice } from '../../../requests/ui/SourceVersionPicker.tsx';

export interface NewRequestProps {
  readonly versions: Loadable<readonly SourceVersionChoice[]>;
  readonly onRetryVersions: () => void;
  readonly onCreate: (versionId: string) => void;
  readonly onCancel: () => void;
  readonly onOpenProjects: () => void;
  readonly busy: boolean;
}

/**
 * Starts a request from one saved version. Every version of the project is listed; one without a source revision
 * stays visible but cannot be chosen, and says why. Creating a request writes a private draft on this device and
 * sends nothing.
 */
export function NewRequest({ versions, onRetryVersions, onCreate, onCancel, onOpenProjects, busy }: NewRequestProps) {
  const [chosen, setChosen] = useState<string | null>(null);
  const list = versions.status === 'ready' ? versions.value : null;
  const usable = list?.filter((version) => version.unavailableReason === null) ?? [];
  // A choice that is no longer in the list, or no longer usable, falls back to the first usable version.
  const selected = usable.find((version) => version.id === chosen)?.id ?? usable[0]?.id ?? null;
  return <div className="hqd-new-request">
    <header>
      <h3>New request</h3>
      <p>Choose the saved version it starts from. Creating it saves a private draft on this device and sends nothing.</p>
    </header>
    {versions.status === 'error' && <InlineNotice tone="danger" title="Couldn't read this project's versions"
      actions={[{ label: 'Try again', onAction: onRetryVersions }]}>{versions.message} Nothing was changed.</InlineNotice>}
    {list !== null && list.length === 0 && <div className="hqd-empty-state hqd-empty-compact">
      <h4>This project has no versions yet</h4>
      <p>A request starts from a saved version. Add or capture one in Projects first.</p>
      <Button variant="primary" size="sm" onClick={onOpenProjects}>Open Projects</Button>
    </div>}
    {list !== null && list.length > 0 && usable.length === 0 && <InlineNotice tone="info" variant="bar" live="off" title="No version can start a request yet"
      actions={[{ label: 'Open Projects', onAction: onOpenProjects }]}>Capture one from a source project.</InlineNotice>}
    {versions.status !== 'error' && (list === null || list.length > 0) && <SourceVersionPicker versions={list} selectedId={selected} onSelect={setChosen} disabled={busy} />}
    <div className="hqd-new-request-actions">
      <GuardedButton variant="primary" busy={busy} busyLabel="Creating request"
        unavailable={selected === null ? (list === null ? 'Versions are still loading.' : 'Choose a version that has a source revision first.') : null}
        onClick={() => { if (selected !== null) onCreate(selected); }}>Create request</GuardedButton>
      <GuardedButton variant="ghost" unavailable={busy ? 'Wait for the request to be created.' : null} onClick={onCancel}>Cancel</GuardedButton>
    </div>
  </div>;
}
