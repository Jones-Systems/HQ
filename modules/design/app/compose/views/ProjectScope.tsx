import type { ProjectContext } from '@hq/contracts';
import type { DesignSectionProps } from '../../../ui/contract.ts';

/** Names the project a Review or Requests section works on. Change returns to Projects to open another. */
export function ProjectScope({ project, navigate }: { readonly project: ProjectContext; readonly navigate: DesignSectionProps['navigate'] }) {
  return <span className="hqd-project-scope">
    <span className="hqd-project-scope-label">Project</span>
    <strong className="hqd-project-scope-name" title={project.name}>{project.name}</strong>
    <button type="button" className="hqd-project-scope-change hq-press" aria-label={`Change project (${project.name})`}
      onClick={() => navigate({ nav: 'projects', section: 'projects' })}>Change</button>
  </span>;
}
