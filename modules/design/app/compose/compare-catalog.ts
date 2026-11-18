import type { VersionCatalogPort, VersionSummary } from '../../compare/src/contract.ts';
import { parseVersionId, parseViewId, projectId, versionId, viewId } from '../../compare/src/ids.ts';
import type { VersionRecord } from '../../projects/src/content.ts';
import type { ProjectId } from '../../projects/src/ids.ts';
import type { ProjectContentRepository } from '../../projects/src/repository.ts';

/** Compare's view/version lookups carry no project argument, so each catalog is project-bound. */
export function createProjectCompareCatalog(repository: ProjectContentRepository, project: ProjectId): VersionCatalogPort {
  const boundProject = projectId(project);
  const load = async (signal?: AbortSignal) => {
    signal?.throwIfAborted();
    const loaded = await repository.load(project);
    signal?.throwIfAborted();
    if (loaded.status !== 'ok') throw new Error(`Project content unavailable: ${loaded.status}`);
    return loaded.content;
  };
  const summary = (version: VersionRecord): VersionSummary => ({
    projectId: boundProject, viewId: viewId(version.viewId), versionId: versionId(version.id),
    label: version.label, createdAt: version.createdAt, route: version.capture.route,
    ...(version.capture.sourceRevision === undefined ? {} : { sourceRevision: version.capture.sourceRevision }),
    // Project content does not retain a separate state or the provenance, time and extent
    // required for a StaticCapture. A digest or thumbnail alone cannot supply that evidence.
    state: '', captures: [],
  });
  return {
    async listViews(requestedProject, signal) {
      signal?.throwIfAborted();
      if (requestedProject !== boundProject) return [];
      const content = await load(signal);
      return content.views.map((view) => ({ projectId: boundProject, viewId: viewId(view.id), name: view.title }));
    },
    async listVersions(requestedView, signal) {
      signal?.throwIfAborted();
      if (parseViewId(requestedView) === null) return [];
      const content = await load(signal);
      return content.versions.filter((version) => version.viewId === requestedView).map(summary);
    },
    async getVersion(requestedVersion, signal) {
      signal?.throwIfAborted();
      if (parseVersionId(requestedVersion) === null) return null;
      const content = await load(signal);
      const version = content.versions.find((item) => item.id === requestedVersion);
      return version === undefined ? null : summary(version);
    },
  };
}
