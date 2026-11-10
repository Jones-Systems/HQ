import type { ComponentId, ComponentSource, Digest, MotionStudy, RenderInput } from './contract.ts';
import { jcsDigest } from './model/jcs.ts';

export interface ComponentRenderRequest {
  readonly componentId: ComponentId;
  readonly revision: number;
  readonly digest: Digest;
  readonly renderInputDigest: Digest;
}
export interface ComponentPlacement {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly visible: boolean;
}
export type ComponentRun = { readonly id: string; readonly evidence: 'web-sandbox' | 'synthetic'; readonly label: string };
export type ComponentRunnerResult<T> = { readonly status: 'ok'; readonly value: T } | { readonly status: 'unavailable'; readonly reason: string };
export interface ComponentCapture extends ComponentRenderRequest {
  readonly viewport: { readonly width: number; readonly height: number; readonly deviceScaleFactor: number };
  readonly captureDigest: Digest;
  readonly evidence: 'web-sandbox' | 'synthetic';
}

/** A host adapter resolves validated source and input digests; no HTML crosses this port. */
export interface ComponentRunnerPort {
  readonly label: string;
  readonly evidence: 'web-sandbox' | 'synthetic';
  render(request: ComponentRenderRequest): Promise<ComponentRunnerResult<ComponentRun>>;
  place(run: ComponentRun, placement: ComponentPlacement): Promise<void>;
  motion(run: ComponentRun, request: { readonly study: MotionStudy; readonly time: number }): Promise<void>;
  capture(run: ComponentRun): Promise<ComponentRunnerResult<ComponentCapture>>;
  close(run: ComponentRun): Promise<void>;
}

export async function componentRenderRequest(source: ComponentSource, input: RenderInput): Promise<ComponentRenderRequest> {
  if (source.componentId !== input.componentId || source.revision !== input.sourceRevision || source.digest !== input.sourceDigest) {
    throw new TypeError('Render input does not match the component revision.');
  }
  return { componentId: source.componentId, revision: source.revision, digest: source.digest, renderInputDigest: await jcsDigest(input) };
}
