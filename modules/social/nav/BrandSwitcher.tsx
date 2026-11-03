import { useId } from 'react';
import { Button } from '@hq/ui';
import type { WorkspaceSnapshot } from '../core';
import { SWITCH_PROJECT_REASON, type ProjectLink } from './brand';

export interface BrandSwitcherProps {
  readonly snapshot: WorkspaceSnapshot | undefined;
  /** 'all' or a brand ID that exists in the snapshot. */
  readonly value: string;
  readonly link: ProjectLink | null;
  readonly onChoose: (brand: string) => void;
  readonly onManage: () => void;
}

function linkLine(link: ProjectLink | null): string | null {
  switch (link?.kind) {
    case undefined:
    case 'all': return null;
    case 'unsupported': return 'HQ project link: proposed, needs Social service support (hq-brand-project-v1).';
    case 'unlinked': return 'Not linked to an HQ project.';
    case 'same': return 'Proposed link to this HQ project. Not a saved HQ mapping.';
    case 'mismatch': return 'Proposed link to a different HQ project. HQ did not switch.';
  }
}

/** Brand switcher with its linked-project line. Brands are managed from here; there is no brands page. */
export function BrandSwitcher({ snapshot, value, link, onChoose, onManage }: BrandSwitcherProps) {
  const id = useId();
  const line = linkLine(link);
  return (
    <div className="sd-brand">
      <label htmlFor={`${id}-brand`}>Brand</label>
      <select
        id={`${id}-brand`} value={snapshot ? value : 'all'} disabled={!snapshot}
        onChange={(event) => onChoose(event.target.value)} aria-describedby={line ? `${id}-link` : undefined}
      >
        <option value="all">{snapshot ? 'All brands' : 'Loading brands…'}</option>
        {snapshot?.brands.map((brand) => <option key={brand.id} value={brand.id}>{brand.name}</option>)}
      </select>
      {line && <p id={`${id}-link`} className="hq-meta">{line}</p>}
      <Button size="sm" variant="ghost" onClick={onManage} disabled={!snapshot}>Manage brands</Button>
    </div>
  );
}

/**
 * Shown when the selected brand's proposed project link names a different HQ project (RC-7). HQ keeps the
 * current project; *Switch HQ project* stays disabled with its reason until a project registry exists.
 */
export function ProjectMismatchBanner({ link, projectName }: { readonly link: ProjectLink; readonly projectName: string }) {
  const id = useId();
  if (link.kind !== 'mismatch') return null;
  return (
    <section className="sd-banner" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>{link.brand.name} belongs to a different HQ project</h2>
      <p>
        Its proposed project link names “{link.projectId}”, but HQ is showing {projectName}. HQ has not switched projects,
        and nothing about this link is saved in HQ.
      </p>
      <span className="sd-inline">
        <Button size="sm" variant="secondary" disabled aria-describedby={`${id}-why`}>Switch HQ project</Button>
        <small id={`${id}-why`} className="hq-meta">{SWITCH_PROJECT_REASON}</small>
      </span>
      <small className="hq-meta">The link comes from the Social service under the proposed hq-brand-project-v1 field.</small>
    </section>
  );
}
