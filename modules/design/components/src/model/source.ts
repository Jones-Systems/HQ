import type { ComponentSource, ComponentSourceInput, DigestPort } from '../contract.ts';
import { brandId } from './ids.ts';
import { deepFreeze } from './jcs.ts';
import { validatePropSpecs } from './props.ts';

const MAX_SOURCE_TEXT = 256 * 1024;
const MAX_SIZE = 8192;

function boundedText(field: string, value: unknown, max: number, allowEmpty: boolean): string {
  if (typeof value !== 'string' || value.length > max || (!allowEmpty && value.trim().length === 0)) {
    throw new TypeError(`Component ${field} must be ${allowEmpty ? 'a' : 'a nonempty'} string of at most ${max} characters.`);
  }
  return value;
}

function dimension(field: string, value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > MAX_SIZE) {
    throw new TypeError(`Component ${field} must be an integer from 1 to ${MAX_SIZE}.`);
  }
  return value;
}

/** Validates authored input and returns a detached plain copy. */
export function parseSourceInput(value: unknown): ComponentSourceInput {
  if (value === null || typeof value !== 'object') throw new TypeError('Component source must be an object.');
  const input = value as Record<string, unknown>;
  const allowed = ['componentId', 'name', 'markup', 'styles', 'script', 'props', 'colorScheme', 'size'];
  const unexpected = Object.keys(input).filter((key) => !allowed.includes(key));
  if (unexpected.length > 0) throw new TypeError(`Unexpected component source fields: ${unexpected.join(', ')}.`);
  if (input.colorScheme !== 'light' && input.colorScheme !== 'dark') throw new TypeError('colorScheme must be light or dark.');
  const size = input.size as Record<string, unknown> | null;
  if (size === null || typeof size !== 'object') throw new TypeError('Component size is required.');
  return {
    componentId: brandId('ComponentId', input.componentId),
    name: boundedText('name', input.name, 200, false),
    markup: boundedText('markup', input.markup, MAX_SOURCE_TEXT, true),
    styles: boundedText('styles', input.styles, MAX_SOURCE_TEXT, true),
    script: boundedText('script', input.script, MAX_SOURCE_TEXT, true),
    props: validatePropSpecs(input.props),
    colorScheme: input.colorScheme,
    size: { width: dimension('width', size.width), height: dimension('height', size.height) },
  };
}

/**
 * Creates one immutable revision. The digest covers authored content only, so
 * identical content always has the same digest regardless of revision number.
 */
export async function createSourceRevision(input: unknown, revision: number, digest: DigestPort): Promise<ComponentSource> {
  if (!Number.isInteger(revision) || revision < 1) throw new TypeError('Revision must be a positive integer.');
  const parsed = parseSourceInput(input);
  return deepFreeze({ ...parsed, revision, digest: await digest.digest(parsed) });
}

/** Re-derives the digest of a stored revision; a mismatch means the bytes changed. */
export async function verifySourceRevision(source: ComponentSource, digest: DigestPort): Promise<boolean> {
  const { revision: _revision, digest: stored, ...content } = source;
  return stored === await digest.digest(parseSourceInput(content));
}
