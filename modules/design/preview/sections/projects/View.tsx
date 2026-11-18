import { use } from 'react';
import type { DesignSectionProps } from '../../../ui/contract.ts';
import { createProjectsSection, createProvisionalLocalRegistry, ProjectsSection } from '../../../projects/src/index.ts';
import '../../../projects/src/projects.css';
import type { FreshnessStatus } from '../../../projects/src/contract.ts';
import {
  createFakeCatalog, createFakeClock, createFakeThumbnailPort, createSpyStorage, previewRefFor,
  seedSyntheticWorkspace, sequentialIds, syntheticCatalogEntry, syntheticPng,
} from '../../../projects/fakes/index.ts';
import { PreviewFrame } from '../../PreviewFrame.tsx';
import { perProject } from '../../seeds.ts';

const STATUSES: readonly FreshnessStatus[] = ['fresh', 'stale', 'offline', 'partial', 'missing-at-source'];

const load = perProject(async (project) => {
  const storage = createSpyStorage();
  const thumbnails = createFakeThumbnailPort();
  const clock = createFakeClock();
  await seedSyntheticWorkspace(storage, thumbnails, 48, { clock, namePrefix: `${project.name.split(' ')[0]} project` });
  const entries = [];
  for (let index = 0; index < 8; index += 1) {
    const bytes = syntheticPng(1000 + index);
    const preview = await previewRefFor(bytes, 'image/png', 32, 20);
    thumbnails.add(preview, bytes);
    entries.push(syntheticCatalogEntry(index + 1, {
      displayName: `Source project ${index + 1}`,
      host: index % 2 ? 'fake-host-b' : 'fake-host-a', hostLabel: index % 2 ? 'Synthetic host B' : 'Synthetic host A',
      status: STATUSES[index % STATUSES.length]!, preview,
    }));
  }
  const catalog = createFakeCatalog(entries);
  const ids = sequentialIds(`preview-${project.id}`);
  const registry = createProvisionalLocalRegistry({ storage, clock, ids });
  const { controller, ready } = createProjectsSection({ registry, storage, thumbnails, catalog, clock, ids });
  await ready;
  return controller;
});

export function ProjectsPreview({ context }: DesignSectionProps) {
  const controller = use(load(context));
  return <PreviewFrame lane="T2 projects" entry="projects/src/index.ts › ProjectsSection"
    notes={['48 synthetic projects', 'cached fake catalog (no refresh)']}>
    <ProjectsSection controller={controller} />
  </PreviewFrame>;
}
