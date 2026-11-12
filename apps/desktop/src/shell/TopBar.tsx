import type { ReactNode } from 'react';
import { StatusIndicator } from '@hq/ui';
import type { Appearance, DomainId, ProjectContext } from '@hq/contracts';
import { DOMAIN_LABELS } from '../domain-metadata';
import type { DataSource } from '../services/data-source-status';
import { AppearanceControl } from './AppearanceControl';
import { ProjectSwitcher } from './ProjectSwitcher';
import { SourcesStatus } from './SourcesStatus';
import { ShellIcon } from './icons';
import type { RecentProject } from './recent-projects';

/** "status-board/42" → "Status board"; the home destination has no crumb. */
export function destinationLabel(destination: string): string | null {
  const words = (destination.split(/[/?#]/u)[0] ?? '').replace(/[-_.]+/gu, ' ').trim();
  if (!words || words === 'home') return null;
  return words[0]!.toUpperCase() + words.slice(1);
}

export interface TopBarProps {
  readonly project: ProjectContext;
  readonly recentProjects: readonly RecentProject[];
  readonly fallbackProject: RecentProject;
  readonly domain: DomainId;
  readonly destination: string;
  readonly settingsOpen: boolean;
  /** Where Back returns to after following a reference; null hides the pill. */
  readonly returnLabel: string | null;
  readonly appearance: Appearance;
  readonly storageAvailable: boolean;
  /** Slot for the command palette trigger. */
  readonly search?: ReactNode;
  readonly onBack: () => void;
  readonly onSelectProject: (project: RecentProject) => void;
  readonly onBrowseProjects: () => void;
  readonly onManageSources: (source: DataSource | null, opener: HTMLElement) => void;
  readonly onAppearance: (next: Appearance, cycled: boolean) => void;
}

export function TopBar(props: TopBarProps) {
  const { domain, settingsOpen, returnLabel } = props;
  const section = settingsOpen ? 'Settings' : DOMAIN_LABELS[domain];
  const leaf = settingsOpen ? null : destinationLabel(props.destination);
  return (
    <header className="shell-topbar" aria-label="HQ workspace">
      <span className="shell-brand"><span className="shell-mark">HQ</span></span>
      <ProjectSwitcher current={props.project} recent={props.recentProjects} fallback={props.fallbackProject} domain={domain}
        onSelect={props.onSelectProject} onBrowse={props.onBrowseProjects} />
      {returnLabel && (
        <button type="button" className="shell-back hq-enter-scale" title={`Back to ${returnLabel}`} onClick={props.onBack}>
          <ShellIcon name="back" /><span className="shell-back-label">Back to {returnLabel}</span>
        </button>
      )}
      <span className="shell-crumbs">
        <span className="shell-crumb-section" aria-current={leaf ? undefined : 'location'}>{section}</span>
        {leaf && <><ShellIcon name="separator" className="shell-crumb-separator" /><span className="shell-crumb-leaf" aria-current="location">{leaf}</span></>}
      </span>
      <span className="shell-spacer" />
      {!props.storageAvailable && (
        <span className="shell-storage" title="Preferences apply for this session only. Local storage is unavailable.">
          <StatusIndicator tone="warning" label="Preferences not saved" />
        </span>
      )}
      <SourcesStatus onManage={props.onManageSources} />
      {props.search}
      <AppearanceControl appearance={props.appearance} onChange={props.onAppearance} />
    </header>
  );
}
