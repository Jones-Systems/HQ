import type {
  CanvasItemDescriptor, CanvasItemHandle, CanvasItemKind, CanvasItemMounter, CanvasItemProvider, CanvasItemResolution,
  ComponentId, ComponentSource, DesignSystemId, DigestPort, MotionStudy, MotionStudyId, ProjectId, VariantId,
} from '../contract.ts';
import { brandId } from '../model/ids.ts';
import { sampleStudy, totalDuration } from '../model/motion.ts';
import { resolveRenderInput } from '../model/props.ts';
import { resolveTokens } from '../model/tokens.ts';
import type { ComponentLibrary } from '../workspace/library.ts';
import { motionFrameMessage, parseSandboxMessage } from './sandbox-channel.ts';
import { createSandboxNonce, sandboxFrameAttributes } from './sandbox-document.ts';

export const COMPONENTS_PROVIDER_ID = 'hq.design.components';

const DEFAULT_VARIANT = '~default';

export type ParsedItem =
  | { readonly kind: 'component-variant'; readonly projectId: ProjectId; readonly componentId: ComponentId; readonly revision: number; readonly variantId: VariantId | null }
  | { readonly kind: 'motion-study'; readonly projectId: ProjectId; readonly studyId: MotionStudyId; readonly revision: number };

function itemKey(kind: CanvasItemKind, entityId: string): string {
  return `${COMPONENTS_PROVIDER_ID}/${kind}/${encodeURIComponent(entityId)}`;
}

function componentEntity(projectId: ProjectId, componentId: ComponentId, revision: number, variantId: VariantId | null): string {
  return [projectId, componentId, String(revision), variantId ?? DEFAULT_VARIANT].map(encodeURIComponent).join('/');
}

function motionEntity(projectId: ProjectId, studyId: MotionStudyId, revision: number): string {
  return [projectId, studyId, String(revision)].map(encodeURIComponent).join('/');
}

export function componentItemKey(projectId: ProjectId, componentId: ComponentId, revision: number, variantId: VariantId | null): string {
  return itemKey('component-variant', componentEntity(projectId, componentId, revision, variantId));
}

export function motionItemKey(projectId: ProjectId, studyId: MotionStudyId, revision: number): string {
  return itemKey('motion-study', motionEntity(projectId, studyId, revision));
}

const REVISION = /^[1-9]\d{0,8}$/u;

/** Parses a key this provider issued; anything else, including "latest", is null. */
export function parseItemKey(key: string): ParsedItem | null {
  const prefix = `${COMPONENTS_PROVIDER_ID}/`;
  if (!key.startsWith(prefix)) return null;
  const [kind, encoded, ...rest] = key.slice(prefix.length).split('/');
  if (encoded === undefined || rest.length > 0) return null;
  try {
    const parts = decodeURIComponent(encoded).split('/').map(decodeURIComponent);
    if (kind === 'component-variant' && parts.length === 4 && REVISION.test(parts[2] as string)) {
      return {
        kind,
        projectId: brandId('ProjectId', parts[0]),
        componentId: brandId('ComponentId', parts[1]),
        revision: Number(parts[2]),
        variantId: parts[3] === DEFAULT_VARIANT ? null : brandId('VariantId', parts[3]),
      };
    }
    if (kind === 'motion-study' && parts.length === 3 && REVISION.test(parts[2] as string)) {
      return { kind, projectId: brandId('ProjectId', parts[0]), studyId: brandId('MotionStudyId', parts[1]), revision: Number(parts[2]) };
    }
  } catch {
    return null;
  }
  return null;
}

export interface ComponentsProviderOptions {
  readonly library: ComponentLibrary;
  readonly digest: DigestPort;
  /** Design system whose tokens items render with; null renders without tokens. */
  readonly designSystemId: DesignSystemId | null;
  /** Window used for frame messages; injectable for tests. */
  readonly window?: Pick<Window, 'addEventListener' | 'removeEventListener'>;
}

export type ComponentsCanvasProvider = CanvasItemProvider & CanvasItemMounter;

/**
 * `CanvasItemProvider` for component variants and motion studies. Canvas owns
 * placement; this provider never writes arrangement, source or variant data.
 */
export function createComponentsCanvasProvider(options: ComponentsProviderOptions): ComponentsCanvasProvider {
  const { library } = options;

  const tokens = async (): Promise<Readonly<Record<string, string>>> => {
    if (options.designSystemId === null) return {};
    const system = (await library.listDesignSystems()).find((item) => item.id === options.designSystemId);
    return system === undefined ? {} : resolveTokens(system).values;
  };

  const describeComponent = (projectId: ProjectId, source: ComponentSource, variantId: VariantId | null, variantName: string | null): CanvasItemDescriptor => {
    const entityId = componentEntity(projectId, source.componentId, source.revision, variantId);
    return {
      key: itemKey('component-variant', entityId),
      providerId: COMPONENTS_PROVIDER_ID,
      kind: 'component-variant',
      entityId,
      projectId,
      title: variantName === null ? `${source.name} r${source.revision}` : `${source.name} r${source.revision} · ${variantName}`,
      sourceRevision: source.digest,
      intrinsicSize: source.size,
      evidence: 'web-sandbox',
      revision: source.revision,
      variantId,
    };
  };

  const describeStudy = async (projectId: ProjectId, study: MotionStudy): Promise<CanvasItemDescriptor> => {
    const target = study.component === undefined ? null : await library.getSource(study.component.componentId, study.component.revision);
    const entityId = motionEntity(projectId, study.id, study.revision);
    return {
      key: itemKey('motion-study', entityId),
      providerId: COMPONENTS_PROVIDER_ID,
      kind: 'motion-study',
      entityId,
      projectId,
      title: `${study.title} r${study.revision}`,
      sourceRevision: await options.digest.digest(study),
      intrinsicSize: target?.size ?? { width: 320, height: 200 },
      evidence: 'web-sandbox',
      revision: study.revision,
      variantId: null,
    };
  };

  const resolveParsed = async (parsed: ParsedItem): Promise<CanvasItemDescriptor | null> => {
    try {
      if (parsed.kind === 'component-variant') {
        const source = await library.getSource(parsed.componentId, parsed.revision);
        if (parsed.variantId === null) return describeComponent(parsed.projectId, source, null, null);
        const variant = (await library.getVariants(source))?.variants.find((item) => item.id === parsed.variantId);
        return variant === undefined ? null : describeComponent(parsed.projectId, source, variant.id, variant.name);
      }
      return await describeStudy(parsed.projectId, await library.getMotionStudy(parsed.studyId, parsed.revision));
    } catch (error) {
      if (error instanceof RangeError) return null;
      throw error;
    }
  };

  return {
    providerId: COMPONENTS_PROVIDER_ID,
    kinds: ['component-variant', 'motion-study'],

    async listItems(projectId: ProjectId, signal?: AbortSignal) {
      const membership = await library.getProjectMembership(projectId);
      const items: CanvasItemDescriptor[] = [];
      for (const entry of membership.components) {
        signal?.throwIfAborted();
        const source = await library.getSource(entry.componentId, entry.revision);
        items.push(describeComponent(projectId, source, null, null));
        for (const variant of (await library.getVariants(source))?.variants ?? []) items.push(describeComponent(projectId, source, variant.id, variant.name));
      }
      for (const entry of membership.studies) {
        signal?.throwIfAborted();
        items.push(await describeStudy(projectId, await library.getMotionStudy(entry.studyId, entry.revision)));
      }
      return items;
    },

    async resolveItem(key: string, signal?: AbortSignal): Promise<CanvasItemResolution> {
      signal?.throwIfAborted();
      const parsed = parseItemKey(key);
      const item = parsed === null ? null : await resolveParsed(parsed);
      return item === null ? { status: 'missing', key } : { status: 'ok', item };
    },

    mount(key: string, host: HTMLElement): CanvasItemHandle {
      const view = options.window ?? globalThis.window;
      let disposed = false;
      let frame: HTMLIFrameElement | null = null;
      let listener: ((event: MessageEvent) => void) | null = null;
      const status = (text: string): void => {
        if (disposed) return;
        const note = host.ownerDocument.createElement('p');
        note.className = 'hqc-item-status';
        note.textContent = text;
        host.replaceChildren(note);
      };
      void (async () => {
        const parsed = parseItemKey(key);
        if (parsed === null) return status('Unknown component item');
        let source: ComponentSource;
        let study: MotionStudy | null = null;
        let variantId: VariantId | null = null;
        if (parsed.kind === 'component-variant') {
          source = await library.getSource(parsed.componentId, parsed.revision);
          variantId = parsed.variantId;
        } else {
          study = await library.getMotionStudy(parsed.studyId, parsed.revision);
          if (study.component === undefined) return status('Motion study has no component');
          source = await library.getSource(study.component.componentId, study.component.revision);
        }
        const input = resolveRenderInput(source, await library.getVariants(source), variantId, {}, await tokens());
        if (disposed) return;
        const nonce = createSandboxNonce();
        const attributes = sandboxFrameAttributes(source, input, { nonce });
        const element = host.ownerDocument.createElement('iframe');
        element.setAttribute('sandbox', attributes.sandbox);
        element.setAttribute('allow', attributes.allow);
        element.setAttribute('referrerpolicy', attributes.referrerPolicy);
        element.title = attributes.title;
        element.width = String(attributes.width);
        element.height = String(attributes.height);
        element.className = 'hqc-item-frame';
        element.srcdoc = attributes.srcdoc;
        frame = element;
        if (study !== null) {
          // A placed study rests on its final frame; the player owns scrubbing.
          const message = motionFrameMessage(study, sampleStudy(study, totalDuration(study)), nonce);
          listener = (event: MessageEvent) => {
            if (parseSandboxMessage(event, element.contentWindow, nonce)?.type === 'ready') element.contentWindow?.postMessage(message, '*');
          };
          view.addEventListener('message', listener);
        }
        host.replaceChildren(element);
      })().catch(() => status('Component item is unavailable'));
      return {
        dispose() {
          disposed = true;
          if (listener !== null) view.removeEventListener('message', listener);
          frame?.remove();
          frame = null;
        },
      };
    },
  };
}
