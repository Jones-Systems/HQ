import { withSectionErrorBoundary } from './SectionErrorBoundary.tsx';
import { use, useSyncExternalStore } from 'react';
import type { DesignSectionProps } from '../../../ui/contract.ts';
import { ProjectsSection } from '../../../projects/src/index.ts';
import '../../../projects/src/projects.css';

import { useDesignWorkspace } from '../workspace-context.tsx';
import { SectionFrame } from './SectionFrame.tsx';

/** Projects over the cached source catalog: discovery's cache document through the Projects read port. */
function ProjectsViewContent({ context }: DesignSectionProps) {
  const workspace = useDesignWorkspace();
  const { discoveryEnv, projectsFor } = workspace;
  const controller = use(projectsFor(context));
  const { readPort } = use(discoveryEnv());
  const status = useSyncExternalStore(readPort.subscribe, readPort.status, readPort.status);
  return <SectionFrame lane="T2 projects" entry="projects/src › ProjectsSection" tags={[workspace.storageTag, status.tag]}
    notes={[`source catalog: ${status.cache}, ${status.entries} cached entries from ${status.hosts} hosts, read from the cache only (no refresh, no source adapter)`]}>
    <ProjectsSection controller={controller} />
  </SectionFrame>;
}

export const ProjectsView = withSectionErrorBoundary(ProjectsViewContent);
