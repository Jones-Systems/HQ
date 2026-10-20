/** R1 skeleton entry for `@hq/ui`. The UI lane builds tokens and primitives here (task.ui-kit.001). */

/** Marker for preserved content that chrome tokens never recolour (spec RS-2, T2 visual system). */
export const PRESERVED_CONTENT_ATTRIBUTE = 'data-hq-content';
export const PRESERVED_CONTENT_KINDS = ['captured', 'producer', 'export'] as const;
export type PreservedContentKind = (typeof PRESERVED_CONTENT_KINDS)[number];
