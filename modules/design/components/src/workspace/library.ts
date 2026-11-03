import type {
  ComponentId, ComponentSource, ComponentStoragePort, DesignSystem, DesignSystemId, DigestPort,
  MotionStudy, MotionStudyId, ProjectId, PropValues, VariantId, VariantSet,
} from '../contract.ts';
import { brandId } from '../model/ids.ts';
import { deepFreeze } from '../model/jcs.ts';
import { parseMotionStudy } from '../model/motion.ts';
import { coerceProp, parseVariantSet } from '../model/props.ts';
import { createSourceRevision, parseSourceInput, verifySourceRevision } from '../model/source.ts';
import { parseDesignSystem } from '../model/tokens.ts';

/**
 * Editable component workspace over the injected StoragePort subset.
 *
 * Key layout (namespace `workspace`):
 *   design-components/source/<component>/<revision>   immutable, write-once
 *   design-components/variants/<component>/<revision> variant set for that exact revision
 *   design-components/session/<component>              panel selection only
 *   design-components/system/<system>                  design system
 *   design-components/motion/<study>/<revision>        immutable, write-once
 *   design-components/project/<project>                exact revisions a project uses
 *
 * Choosing a variant or override writes only the session key; source keys are
 * never rewritten. Everything read back is validated as untrusted input.
 */

const ROOT = 'design-components';
const NS = 'workspace';

const enc = (value: string): string => encodeURIComponent(value);
const revisionKey = (revision: number): string => String(revision).padStart(8, '0');

export const keys = {
  sourcePrefix: (id: ComponentId) => `${ROOT}/source/${enc(id)}/`,
  source: (id: ComponentId, revision: number) => `${ROOT}/source/${enc(id)}/${revisionKey(revision)}`,
  variants: (id: ComponentId, revision: number) => `${ROOT}/variants/${enc(id)}/${revisionKey(revision)}`,
  session: (id: ComponentId) => `${ROOT}/session/${enc(id)}`,
  system: (id: DesignSystemId) => `${ROOT}/system/${enc(id)}`,
  motionPrefix: (id: MotionStudyId) => `${ROOT}/motion/${enc(id)}/`,
  motion: (id: MotionStudyId, revision: number) => `${ROOT}/motion/${enc(id)}/${revisionKey(revision)}`,
  project: (id: ProjectId) => `${ROOT}/project/${enc(id)}`,
};

/** Which exact revisions a project shows. Membership never follows "latest". */
export interface ProjectMembership {
  readonly projectId: ProjectId;
  readonly components: readonly { readonly componentId: ComponentId; readonly revision: number }[];
  readonly studies: readonly { readonly studyId: MotionStudyId; readonly revision: number }[];
}

export interface ComponentSession {
  readonly componentId: ComponentId;
  readonly revision: number;
  readonly variantId: VariantId | null;
  readonly overrides: PropValues;
}

export class IntegrityError extends Error {}

function revisionsFrom(prefix: string, keyList: readonly string[]): number[] {
  return keyList
    .filter((key) => key.startsWith(prefix) && /^\d{8}$/u.test(key.slice(prefix.length)))
    .map((key) => Number(key.slice(prefix.length)))
    .sort((a, b) => a - b);
}

export class ComponentLibrary {
  readonly #storage: ComponentStoragePort;
  readonly #digest: DigestPort;

  constructor(storage: ComponentStoragePort, digest: DigestPort) {
    this.#storage = storage;
    this.#digest = digest;
  }

  async listComponents(): Promise<readonly ComponentId[]> {
    const all = await this.#storage.listKeys(NS, `${ROOT}/source/`);
    const ids = new Set(all.map((key) => key.slice(`${ROOT}/source/`.length).split('/')[0]).filter((id): id is string => id !== undefined && id.length > 0));
    return [...ids].map((id) => brandId('ComponentId', decodeURIComponent(id))).sort();
  }

  async revisions(id: ComponentId): Promise<readonly number[]> {
    return revisionsFrom(keys.sourcePrefix(id), await this.#storage.listKeys(NS, keys.sourcePrefix(id)));
  }

  /**
   * Saves authored content as the next revision. Unchanged content returns the
   * existing latest revision without writing. Existing revisions are never overwritten.
   */
  async saveSource(input: unknown): Promise<ComponentSource> {
    const parsed = parseSourceInput(input);
    const existing = await this.revisions(parsed.componentId);
    const latest = existing.at(-1);
    if (latest !== undefined) {
      const current = await this.getSource(parsed.componentId, latest);
      const candidate = await createSourceRevision(parsed, latest, this.#digest);
      if (candidate.digest === current.digest) return current;
    }
    const revision = (latest ?? 0) + 1;
    const key = keys.source(parsed.componentId, revision);
    if (await this.#storage.readDocument(NS, key) !== undefined) throw new IntegrityError(`Revision ${revision} already exists.`);
    const source = await createSourceRevision(parsed, revision, this.#digest);
    await this.#storage.writeDocument(NS, key, source);
    return source;
  }

  /** Reads one exact revision and re-verifies its digest. */
  async getSource(id: ComponentId, revision: number): Promise<ComponentSource> {
    const stored = await this.#storage.readDocument(NS, keys.source(id, revision));
    if (stored === undefined) throw new RangeError(`Component ${id} has no revision ${revision}.`);
    const record = stored as Record<string, unknown>;
    const { revision: storedRevision, digest, ...content } = record;
    if (storedRevision !== revision) throw new IntegrityError('Stored revision number does not match its key.');
    const source = deepFreeze({ ...parseSourceInput(content), revision, digest }) as ComponentSource;
    if (source.componentId !== id || !(await verifySourceRevision(source, this.#digest))) {
      throw new IntegrityError(`Component ${id} revision ${revision} does not match its digest.`);
    }
    return source;
  }

  async saveVariants(source: ComponentSource, set: unknown): Promise<VariantSet> {
    const parsed = parseVariantSet(source, set);
    await this.#storage.writeDocument(NS, keys.variants(source.componentId, source.revision), parsed);
    return parsed;
  }

  async getVariants(source: ComponentSource): Promise<VariantSet | null> {
    const stored = await this.#storage.readDocument(NS, keys.variants(source.componentId, source.revision));
    return stored === undefined ? null : parseVariantSet(source, stored);
  }

  /** Persists panel selection only. It never touches source or variant documents. */
  async saveSession(source: ComponentSource, variants: VariantSet | null, variantId: VariantId | null, overrides: PropValues): Promise<ComponentSession> {
    if (variantId !== null && !(variants?.variants.some((variant) => variant.id === variantId) ?? false)) {
      throw new RangeError(`Unknown variant "${variantId}".`);
    }
    const checked: Record<string, string | number | boolean> = {};
    for (const [name, value] of Object.entries(overrides)) {
      const spec = source.props[name];
      if (spec === undefined) throw new RangeError(`Undeclared prop "${name}".`);
      checked[name] = coerceProp(name, spec, value);
    }
    const session = deepFreeze({ componentId: source.componentId, revision: source.revision, variantId, overrides: checked });
    await this.#storage.writeDocument(NS, keys.session(source.componentId), session);
    return session;
  }

  /** Returns the stored session, or null when it is missing or no longer valid. */
  async getSession(id: ComponentId): Promise<ComponentSession | null> {
    const stored = await this.#storage.readDocument(NS, keys.session(id)) as Record<string, unknown> | undefined;
    if (stored === undefined || stored === null || typeof stored !== 'object' || stored.componentId !== id || !Number.isInteger(stored.revision)) return null;
    try {
      const source = await this.getSource(id, stored.revision as number);
      const variants = await this.getVariants(source);
      const variantId = stored.variantId === null ? null : brandId('VariantId', stored.variantId);
      if (variantId !== null && !(variants?.variants.some((variant) => variant.id === variantId) ?? false)) return null;
      const overrides = stored.overrides as Record<string, unknown>;
      const checked: Record<string, string | number | boolean> = {};
      for (const [name, value] of Object.entries(overrides ?? {})) {
        const spec = source.props[name];
        if (spec === undefined) return null;
        checked[name] = coerceProp(name, spec, value);
      }
      return deepFreeze({ componentId: id, revision: source.revision, variantId, overrides: checked });
    } catch {
      return null;
    }
  }

  async saveDesignSystem(system: unknown): Promise<DesignSystem> {
    const parsed = parseDesignSystem(system);
    await this.#storage.writeDocument(NS, keys.system(parsed.id), parsed);
    return parsed;
  }

  async listDesignSystems(): Promise<readonly DesignSystem[]> {
    const all = await this.#storage.listKeys(NS, `${ROOT}/system/`);
    const systems = await Promise.all(all.map(async (key) => parseDesignSystem(await this.#storage.readDocument(NS, key))));
    return systems.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  async motionRevisions(id: MotionStudyId): Promise<readonly number[]> {
    return revisionsFrom(keys.motionPrefix(id), await this.#storage.listKeys(NS, keys.motionPrefix(id)));
  }

  async listMotionStudies(): Promise<readonly MotionStudyId[]> {
    const all = await this.#storage.listKeys(NS, `${ROOT}/motion/`);
    const ids = new Set(all.map((key) => key.slice(`${ROOT}/motion/`.length).split('/')[0]).filter((id): id is string => id !== undefined && id.length > 0));
    return [...ids].map((id) => brandId('MotionStudyId', decodeURIComponent(id))).sort();
  }

  /** Saves a study draft as the next revision; earlier revisions are untouched. */
  async saveMotionStudy(draft: unknown): Promise<MotionStudy> {
    const probe = parseMotionStudy({ ...(draft as object), revision: 1 });
    const revision = ((await this.motionRevisions(probe.id)).at(-1) ?? 0) + 1;
    const study = parseMotionStudy({ ...probe, revision });
    const key = keys.motion(study.id, revision);
    if (await this.#storage.readDocument(NS, key) !== undefined) throw new IntegrityError(`Motion revision ${revision} already exists.`);
    await this.#storage.writeDocument(NS, key, study);
    return study;
  }

  async getMotionStudy(id: MotionStudyId, revision: number): Promise<MotionStudy> {
    const stored = await this.#storage.readDocument(NS, keys.motion(id, revision));
    if (stored === undefined) throw new RangeError(`Motion study ${id} has no revision ${revision}.`);
    const study = parseMotionStudy(stored);
    if (study.id !== id || study.revision !== revision) throw new IntegrityError('Stored motion study does not match its key.');
    return study;
  }

  async setProjectMembership(membership: ProjectMembership): Promise<ProjectMembership> {
    const parsed = await this.#checkMembership(membership);
    await this.#storage.writeDocument(NS, keys.project(parsed.projectId), parsed);
    return parsed;
  }

  async getProjectMembership(projectId: ProjectId): Promise<ProjectMembership> {
    const stored = await this.#storage.readDocument(NS, keys.project(projectId));
    if (stored === undefined) return { projectId, components: [], studies: [] };
    const parsed = await this.#checkMembership(stored);
    if (parsed.projectId !== projectId) throw new IntegrityError('Stored membership belongs to another project.');
    return parsed;
  }

  async #checkMembership(value: unknown): Promise<ProjectMembership> {
    const record = value as Record<string, unknown> | null;
    if (record === null || typeof record !== 'object' || !Array.isArray(record.components) || !Array.isArray(record.studies)) {
      throw new TypeError('Project membership is invalid.');
    }
    const components = record.components.map((item: unknown) => {
      const entry = item as Record<string, unknown>;
      if (!Number.isInteger(entry?.revision)) throw new TypeError('Membership needs exact component revisions.');
      return { componentId: brandId('ComponentId', entry.componentId), revision: entry.revision as number };
    });
    const studies = record.studies.map((item: unknown) => {
      const entry = item as Record<string, unknown>;
      if (!Number.isInteger(entry?.revision)) throw new TypeError('Membership needs exact study revisions.');
      return { studyId: brandId('MotionStudyId', entry.studyId), revision: entry.revision as number };
    });
    for (const entry of components) await this.getSource(entry.componentId, entry.revision);
    for (const entry of studies) await this.getMotionStudy(entry.studyId, entry.revision);
    return deepFreeze({ projectId: brandId('ProjectId', record.projectId), components, studies });
  }
}
