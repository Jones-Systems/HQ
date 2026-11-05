import type { PropValues } from '../contract.ts';

/** Module-local markup schema: marker values name resolved props, never expressions. */
export const PROP_SLOT_SCHEMA = Object.freeze({ text: 'data-hq-text', attributePrefix: 'data-hq-attr-' });
const TEXT_ATTRIBUTES = new Set(['title', 'alt', 'value', 'placeholder', 'role']);
const BOOLEAN_ATTRIBUTES = new Set(['disabled', 'checked', 'selected', 'hidden', 'readonly', 'required', 'multiple']);

/** Bind an inert parsed fragment before host serialization; this is not an HTML sanitizer. */
export function bindPropSlots(root: ParentNode, props: PropValues): void {
  const writes: (() => void)[] = [];
  for (const element of root.querySelectorAll('*')) {
    for (const marker of Array.from(element.attributes)) {
      if (marker.name !== PROP_SLOT_SCHEMA.text && !marker.name.startsWith(PROP_SLOT_SCHEMA.attributePrefix)) continue;
      if (!Object.hasOwn(props, marker.value)) throw new TypeError(`Unknown slot prop: ${marker.value}`);
      const value = props[marker.value]!;
      if (marker.name === PROP_SLOT_SCHEMA.text) {
        writes.push(() => { element.textContent = String(value); });
        continue;
      }
      const name = marker.name.slice(PROP_SLOT_SCHEMA.attributePrefix.length);
      if (BOOLEAN_ATTRIBUTES.has(name)) {
        if (typeof value !== 'boolean') throw new TypeError(`Boolean slot required: ${name}`);
        writes.push(() => { if (value) element.setAttribute(name, ''); else element.removeAttribute(name); });
      } else if (TEXT_ATTRIBUTES.has(name) || /^aria-[a-z][a-z-]*$/u.test(name) || /^data-(?!hq-)[a-z][a-z0-9-]*$/u.test(name)) {
        writes.push(() => element.setAttribute(name, String(value)));
      } else throw new TypeError(`Unsupported slot attribute: ${name}`);
    }
  }
  for (const write of writes) write();
}
