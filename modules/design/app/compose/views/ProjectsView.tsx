import { use, useSyncExternalStore } from 'react';
import type { DesignSectionProps } from '../../../ui/contract.ts';
import { ProjectsSection } from '../../../projects/src/index.ts';
import '../../../projects/src/projects.css';
import { FAKE_TAG } from '../labels.ts';
import { discoveryEnv, projectsFor } from '../workspace.ts';
import { SectionFrame } from './SectionFrame.tsx';

/** Projects over the cached source catalog: discovery's cache document through the Projects read port. */
export function ProjectsView({ context }: DesignSectionProps) {
  const controller = use(projectsFor(context));
  const { readPort } = use(discoveryEnv());
  const status = useSyncExternalStore(readPort.subscribe, readPort.status, readPort.status);
  return <SectionFrame lane="T2 projects" entry="projects/src › ProjectsSection" tags={[FAKE_TAG, status.tag]}
    notes={[`source catalog: ${status.cache}, ${status.entries} cached entries from ${status.hosts} hosts, read from the cache only (no refresh, no source adapter)`]}>
    <ProjectsSection controller={controller} />
  </SectionFrame>;
}
