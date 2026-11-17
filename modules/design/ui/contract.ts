/**
 * Section-local contract for Design's own chrome (T14 / HQD-13).
 *
 * These ports satisfy the first-deliverable prerequisite until root promotes
 * shared types into @hq/contracts. Everything here is React-free so the
 * framework-free models and Node tests can use it directly; the React layer
 * specialises the `View` parameter.
 */
import type { DesktopPort, ProjectContext, ResolvedAppearance } from '@hq/contracts';

/** Design sub-navigation areas, in display and keyboard order. */
export const DESIGN_NAV_IDS = ['projects', 'resources', 'review', 'requests', 'runs'] as const;
export type DesignNavId = (typeof DESIGN_NAV_IDS)[number];

export type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue };

/**
 * Chrome colour tokens supplied by the HQ shell. Names follow the shell's
 * stylesheet variables. They recolour Design chrome only and are never applied
 * to captures or producer previews.
 */
export interface ShellThemeTokens {
  readonly background: string;
  readonly surface: string;
  readonly text: string;
  readonly muted: string;
  readonly line: string;
  readonly selected: string;
  readonly accent: string;
}

export interface ShellContextSnapshot {
  readonly context: ProjectContext;
  readonly appearance: ResolvedAppearance;
  readonly tokens: ShellThemeTokens;
  readonly desktop: DesktopPort;
}

/**
 * What the HQ shell gives Design beyond ModulePort. The shell owns project
 * context: Design may only *request* a switch, and only after an explicit user
 * confirmation. Requesting never dispatches work.
 */
export interface ShellContextPort {
  readonly getSnapshot: () => ShellContextSnapshot;
  readonly subscribe: (listener: () => void) => () => void;
  /** Null when this shell cannot switch projects from Design; the prompt says so. */
  readonly requestProjectContext: ((projectId: string) => void) | null;
}

/** Synchronous key/value persistence for chrome state (matches the shell StoragePort shape). */
export interface UiStatePort {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * Where Design is showing something. Serialised into ModulePort.destination.
 *
 * `sub` is the section-owned view inside `section`: a fixed id the section's
 * descriptor declares (`SectionSubRoutes.fixed`), or `item/<encodeURIComponent(id)>`
 * for sections that declare `itemPrefix`. Absent and null are the same: no explicit
 * view, so the remembered preference and then the default apply. Callers that only
 * know `{ nav, section }` stay valid.
 */
export interface DesignLocation {
  readonly nav: DesignNavId;
  readonly section: string | null;
  readonly sub?: string | null;
}

/** One fixed view of a section, such as Compare's `swipe`. The id is route grammar; the title is display text. */
export interface SectionSubRoute {
  /** Lowercase letters, digits and hyphens, starting with a letter, at most 32 characters; never `item`. */
  readonly id: string;
  readonly title: string;
}

/**
 * Cheap routing metadata a descriptor may declare so the chrome can parse, format and
 * navigate its views without loading any section code. It is not a claim that the
 * section renders alternate views: a section consumes `sub` only when it says so.
 */
export interface SectionSubRoutes {
  readonly fixed: readonly SectionSubRoute[];
  /** Whether the fixed views appear as children of the section in navigation (Compare) or stay inside it (Flows). */
  readonly navChildren: boolean;
  /** Set for sections whose views include one route per library entry: `item/<encodeURIComponent(id)>`. */
  readonly itemPrefix?: 'item';
}

/** Opaque per-section chrome state (draft text, viewport, selection…) kept across domain switches. */
export interface SectionStateHandle {
  readonly read: () => JsonValue | undefined;
  /** Returns false when the value is not plain JSON or exceeds the bound; nothing is truncated. */
  readonly write: (value: JsonValue) => boolean;
}

/** Commands a section contributes to the palette. Handlers only change local UI state. */
export interface SectionCommand {
  readonly id: string;
  readonly title: string;
  readonly keywords?: readonly string[];
}

/**
 * Registry convention: each section that wants to appear in Design exports
 * `designModule` from `modules/design/<id>/design-module.ts`. The descriptor
 * must stay cheap to evaluate; `view` is a lazy loader so section code is only
 * fetched when shown.
 */
export interface DesignSectionDescriptor<View = unknown> {
  readonly schema: 'hq.design.section/v1';
  /** Stable id; must equal the directory name. Never derived from the title. */
  readonly id: string;
  readonly title: string;
  readonly nav: DesignNavId;
  readonly order?: number;
  readonly commands?: readonly SectionCommand[];
  /** Optional routing metadata for the section's views; see `SectionSubRoutes`. Data only, never view code. */
  readonly subRoutes?: SectionSubRoutes;
  readonly view: () => Promise<View>;
}

/** Props every section view receives from the chrome. */
export interface DesignSectionProps {
  readonly context: ProjectContext;
  readonly appearance: ResolvedAppearance;
  readonly sectionId: string;
  /**
   * Chrome state for this section. A section that declares `subRoutes` receives a handle
   * that reaches only its own data; the remembered view is kept beside it and never exposed here.
   */
  readonly state: SectionStateHandle;
  /**
   * The effective view: an explicit valid route view, else the view remembered for this project and
   * section, else the descriptor default (null for sections that declare none, and for item sections).
   */
  readonly sub: string | null;
  /** True only when `sub` came from the route itself; a remembered or default view is not explicit. */
  readonly subExplicit: boolean;
  /** Choose a view of this section. Null shows the section's remembered or default view. Never remounts the section. */
  readonly navigateSub: (sub: string | null) => void;
  readonly navigate: (location: DesignLocation) => void;
  /** Opens a confirmation prompt; never switches project context by itself. */
  readonly proposeProjectSwitch: (projectId: string, label: string) => void;
  /** Spread onto any element showing captured bytes or a producer preview. */
  readonly surface: (kind: SurfaceKind, intendedScheme?: IntendedScheme) => SurfaceProps;
  /** Subscribe to palette commands this section declared. */
  readonly onCommand: (listener: (commandId: string) => void) => () => void;
}

export type SurfaceKind = 'capture' | 'preview';
/** A preview's own colour scheme, chosen by its version state, never by HQ appearance. */
export type IntendedScheme = 'normal' | 'light' | 'dark';

export interface SurfaceStyle {
  readonly colorScheme: IntendedScheme;
  readonly filter: 'none';
  readonly mixBlendMode: 'normal';
  readonly opacity: 1;
  readonly isolation: 'isolate';
  readonly forcedColorAdjust: 'none';
  readonly backgroundColor: 'transparent';
}

export interface SurfaceProps {
  readonly 'data-hqd-surface': SurfaceKind;
  readonly style: SurfaceStyle;
}

/** Descriptor handed to the HQ shell for the Design domain. */
export interface DesignDomain<Component = unknown> {
  readonly id: 'design';
  readonly label: 'Design';
  readonly order: 0;
  /** Hint: the shell may keep the view mounted while hidden. State survives either way. */
  readonly keepAlive: true;
  /** Design fills the module area edge to edge; the shell should not pad it. */
  readonly presentation: 'fill';
  readonly Component: Component;
  /** Serialise chrome state for a project (null when nothing is held). */
  readonly serialize: (projectId: string) => string | null;
  /** Restore chrome state from text; rejects without writing on invalid or future input. */
  readonly restore: (projectId: string, text: string) => RestoreResult;
  /** Shell calls this when leaving Design; flushes chrome state. Never submits drafts. */
  readonly deactivate: () => void;
}

export type RestoreResult =
  | { readonly status: 'restored' }
  | { readonly status: 'rejected'; readonly reason: string };
