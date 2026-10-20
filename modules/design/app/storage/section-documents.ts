import type { WorkspaceDocuments } from './backing.ts';

export const DEVICE_STORAGE_LABEL = 'Saved on this device';
export const PROJECTS_KEY_ROOT = 'design/projects/';
export const COMPONENTS_KEY_ROOT = 'design/components/';
export const FLOWS_KEY_ROOT = 'design/flows/';
export const COMPARE_KEY_ROOT = 'design/compare/';
export const ANNOTATIONS_KEY_ROOT = 'design/annotations/';

export class SectionStorageScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SectionStorageScopeError';
  }
}

const ROOTS = [PROJECTS_KEY_ROOT, COMPONENTS_KEY_ROOT, FLOWS_KEY_ROOT, COMPARE_KEY_ROOT,
  ANNOTATIONS_KEY_ROOT, 'design.canvas.arrangement.v1/', 'design/requests/', 'design/connector/', 'design/storage/'];
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/u;
const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

/** Keys are opaque lane keys: always prepend the fixed root, never normalize or resolve paths. */
export function sectionKey(workspace: WorkspaceDocuments, root: string): (namespace: string, key: string, prefix?: boolean) => string {
  if (workspace.kind !== 'workspace' || workspace.namespace !== 'workspace') {
    throw new SectionStorageScopeError('Section documents require the workspace namespace and view');
  }
  return (namespace, key, prefix = false) => {
    if (namespace !== 'workspace') throw new SectionStorageScopeError('Only the workspace namespace is available');
    const composed = root + key;
    if (typeof key !== 'string' || (key.length === 0 && !prefix) || key.startsWith('/') || key.split('/').includes('..')
      || CONTROL.test(key) || LONE_SURROGATE.test(key) || composed.length > 256 || composed.trim() !== composed
      || ROOTS.some((other) => other !== root && (key.startsWith(other) || key === other.slice(0, -1)))) {
      throw new SectionStorageScopeError('Invalid or out-of-section document key');
    }
    return composed;
  };
}
