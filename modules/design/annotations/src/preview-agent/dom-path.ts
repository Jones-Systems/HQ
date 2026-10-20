/** Minimal element shape; real DOM elements satisfy it structurally. */
export interface PathElement {
  readonly tagName: string;
  readonly id: string;
  readonly parentElement: PathElement | null;
  readonly children: ArrayLike<PathElement>;
}

const SIMPLE_ID = /^[A-Za-z][\w-]{0,127}$/u;

/**
 * Builds a deterministic CSS selector path for an element. A unique simple id
 * ends the walk; otherwise segments use `:nth-of-type` when same-tag siblings
 * exist. The result is a selector, never a filesystem path.
 */
export function elementPath(element: PathElement, isUniqueId: (id: string) => boolean): string {
  const segments: string[] = [];
  let current: PathElement | null = element;
  while (current !== null) {
    const tag = current.tagName.toLowerCase();
    if (current.id !== '' && SIMPLE_ID.test(current.id) && isUniqueId(current.id)) {
      segments.unshift(`#${current.id}`);
      break;
    }
    const parent: PathElement | null = current.parentElement;
    if (parent === null) {
      segments.unshift(tag);
      break;
    }
    let index = 0;
    let count = 0;
    for (let i = 0; i < parent.children.length; i += 1) {
      const sibling = parent.children[i]!;
      if (sibling.tagName === current.tagName) {
        count += 1;
        if (sibling === current) index = count;
      }
    }
    segments.unshift(count > 1 ? `${tag}:nth-of-type(${index})` : tag);
    current = parent;
  }
  return segments.join(' > ');
}

/** FNV-1a 32-bit over normalized text; a change detector, not a security digest. */
export function textHash(text: string): string {
  const normalized = text.replace(/\s+/gu, ' ').trim().slice(0, 4096);
  let hash = 0x811c9dc5;
  for (let i = 0; i < normalized.length; i += 1) {
    hash ^= normalized.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `fnv1a32:${hash.toString(16).padStart(8, '0')}`;
}
