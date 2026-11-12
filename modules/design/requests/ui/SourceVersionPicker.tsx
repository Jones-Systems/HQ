import { Skeleton } from '@hq/ui';
import { useId, type MouseEvent } from 'react';
import './requests.css';

/** One saved version a request could start from. */
export interface SourceVersionChoice {
  readonly id: string;
  readonly viewId: string;
  /** Title of the view the version belongs to. */
  readonly viewTitle: string;
  readonly label: string;
  readonly ordinal: number;
  /** One short line about the capture, such as its route and viewport. */
  readonly detail: string;
  /** Why the version cannot start a request, or null when it can. */
  readonly unavailableReason: string | null;
}

export interface SourceVersionPickerProps {
  /** Null while the versions are loading. */
  readonly versions: readonly SourceVersionChoice[] | null;
  readonly selectedId: string | null;
  readonly onSelect: (versionId: string) => void;
  readonly disabled?: boolean;
}

/**
 * Every version of the project, grouped by view. A version without a source revision stays listed but cannot be
 * chosen: its radio is `aria-disabled` (not `disabled`), so keyboard focus still reaches it, and the full reason
 * shows in the row on hover and focus and is read out through `aria-describedby`.
 */
export function SourceVersionPicker({ versions, selectedId, onSelect, disabled = false }: SourceVersionPickerProps) {
  const name = useId();
  if (versions === null) {
    return <div className="hqr-versions-loading" aria-busy="true">
      <span role="status" className="hq-sr-only">Loading versions…</span>
      <Skeleton shape="block" height="46px" />
      <Skeleton shape="block" height="46px" />
      <Skeleton shape="block" height="46px" />
    </div>;
  }
  const groups = new Map<string, { title: string; versions: SourceVersionChoice[] }>();
  for (const version of versions) {
    const group = groups.get(version.viewId) ?? { title: version.viewTitle, versions: [] };
    group.versions.push(version);
    groups.set(version.viewId, group);
  }
  return <div className="hqr-versions" role="radiogroup" aria-label="Source version">
    {[...groups.entries()].map(([viewId, group]) => <div key={viewId} className="hqr-version-group" role="group" aria-label={group.title}>
      <h4 className="hqr-version-view">{group.title}</h4>
      {[...group.versions].sort((a, b) => b.ordinal - a.ordinal).map((version) =>
        <VersionRow key={version.id} version={version} name={name} checked={version.id === selectedId} disabled={disabled} onSelect={onSelect} />)}
    </div>)}
  </div>;
}

function VersionRow({ version, name, checked, disabled, onSelect }: {
  readonly version: SourceVersionChoice; readonly name: string; readonly checked: boolean; readonly disabled: boolean;
  readonly onSelect: (versionId: string) => void;
}) {
  const reasonId = useId();
  const unavailable = version.unavailableReason !== null;
  const refuse = (event: MouseEvent<HTMLInputElement>) => { if (unavailable || disabled) event.preventDefault(); };
  return <label className="hqr-version" data-unavailable={unavailable} data-checked={checked}>
    <input type="radio" name={name} value={version.id} checked={checked && !unavailable}
      aria-disabled={unavailable || disabled || undefined} aria-describedby={unavailable ? reasonId : undefined}
      onClick={refuse} onChange={() => { if (!unavailable && !disabled) onSelect(version.id); }} />
    <span className="hqr-version-text">
      <span className="hqr-version-label">{version.label}</span>
      {unavailable
        ? <span className="hqr-version-note">
          <span className="hqr-version-short">No source revision yet</span>
          <span id={reasonId} className="hqr-version-reason">{version.unavailableReason}</span>
        </span>
        : <span className="hqr-version-note"><span className="hqr-version-short">{version.detail}</span></span>}
    </span>
  </label>;
}
