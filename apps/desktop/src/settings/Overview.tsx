import { Skeleton } from '@hq/ui';
import type { DataSource } from '../services/data-source-status';
import { useDataSources } from './DataSources';
import { useSourceCheck } from './use-source-check';
import { useSettingsActions } from './actions';
import type { ProjectStatus } from './project-status';
import type { SettingsCategory } from './categories';
import { ActionButton, ChipBadge, Panel, RotateLabel, Row, SettingsHeading, type IconName } from './parts';
import { chipFor, detailFor, jonesSummary, projectsSummary, type Chip } from './status';


const NEEDS_ATTENTION = new Set<Chip['tone']>(['danger', 'warning', 'unavailable']);

interface Summary { key: string; icon: IconName; name: string; chip?: Chip; detail?: string; loading?: boolean; category: SettingsCategory; row?: DataSource }

/** One status row per data source, with the control that fixes it one click away. */
export function Overview({ headingId, project, onManage }: { headingId: string; project: ProjectStatus; onManage: (category: SettingsCategory, row?: DataSource) => void }) {
  const { statuses, busy: checkingAny } = useDataSources();
  const runCheck = useSourceCheck();
  const actions = useSettingsActions();
  const recheck = () => actions.run({
    id: 'recheck-all', row: 'overview', lost: "Couldn't recheck every source", check: () => { void recheck(); },
    work: async () => {
      const results = [];
      for (const source of ['social', 'work', 'wiki'] as const) results.push(await runCheck(source));
      await project.refresh();
      const attention = results.filter(result => NEEDS_ATTENTION.has(chipFor(result).tone)).length;
      return { ok: true, toast: { title: 'Rechecked all data sources', ...(attention ? { description: `${attention} of 3 need attention.` } : {}) } };
    },
  });
  const projects = projectsSummary(project.sources), jones = jonesSummary(project.jones);
  const rows: readonly Summary[] = [
    { key: 'social', icon: 'social', name: 'Social', chip: chipFor(statuses.social), detail: detailFor('social', statuses.social), category: 'services', row: 'social' },
    { key: 'work', icon: 'work', name: 'Work', chip: chipFor(statuses.work), detail: detailFor('work', statuses.work), category: 'services', row: 'work' },
    { key: 'wiki', icon: 'wiki', name: 'Local Wiki', chip: chipFor(statuses.wiki), detail: detailFor('wiki', statuses.wiki), category: 'wiki', row: 'wiki' },
    { key: 'projects', icon: 'projects', name: 'Project sources', chip: projects.chip, detail: projects.detail, loading: project.loading, category: 'projects' },
    { key: 'jones', icon: 'jones', name: 'Jones requests', chip: jones.chip, detail: jones.detail, loading: project.loading, category: 'projects' },
  ];
  const working = actions.pendingId === 'recheck-all';
  return <>
    <SettingsHeading id={headingId} title="Overview" actions={
      <ActionButton size="sm" working={working} reason={actions.blocked('recheck-all') ?? (checkingAny && !working ? 'Another check is running.' : null)} onClick={() => void recheck()}>
        <RotateLabel busy={working} label="Recheck all" busyLabel="Rechecking" />
      </ActionButton>
    }>Where HQ gets its data. Each source shows its health and a Manage button for the settings that fix it. These are data sources, not device, SSH or environment connections.</SettingsHeading>
    <Panel aria-label="Data source status" busy={project.loading}>
      {rows.map(row => <Row key={row.key} icon={row.icon} title={row.name} statusInline
        status={row.loading ? <Skeleton width="72px" /> : row.chip && <ChipBadge chip={row.chip} />}
        description={row.loading ? <Skeleton width="55%" /> : row.detail}
        control={<ActionButton size="sm" aria-label={`Manage ${row.name}`} onClick={() => onManage(row.category, row.row)}>Manage</ActionButton>} />)}
    </Panel>
  </>;
}
