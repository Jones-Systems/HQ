import type { MotionFrame, MotionStudy } from '../contract.ts';
import { frameToStyles } from '../model/motion.ts';
import { SANDBOX_CHANNEL } from './sandbox-document.ts';

/**
 * Host side of the sandbox channel. The frame can only *post* to the host; the
 * host accepts a message only from the exact frame window, from an opaque
 * origin, with that frame's nonce and a known shape. Nothing a component posts
 * can invoke a host capability: the only effects are size and status display.
 */
export type SandboxEvent =
  | { readonly type: 'ready' }
  | { readonly type: 'size'; readonly width: number; readonly height: number }
  | { readonly type: 'error'; readonly message: string }
  | { readonly type: 'probe'; readonly results: Readonly<Record<string, string>> };

export interface SandboxMessageLike {
  readonly source: unknown;
  readonly origin: string;
  readonly data: unknown;
}

const MAX_FRAME_SIZE = 8192;

export function parseSandboxMessage(event: SandboxMessageLike, frameWindow: unknown, nonce: string): SandboxEvent | null {
  if (frameWindow === null || frameWindow === undefined || event.source !== frameWindow) return null;
  // A sandbox without allow-same-origin always reports the opaque origin "null".
  if (event.origin !== 'null') return null;
  const data = event.data as Record<string, unknown> | null;
  if (data === null || typeof data !== 'object' || data.channel !== SANDBOX_CHANNEL || data.nonce !== nonce) return null;
  const detail = data.detail as Record<string, unknown> | null;
  if (detail === null || typeof detail !== 'object') return null;
  switch (data.type) {
    case 'ready':
      return { type: 'ready' };
    case 'size': {
      const { width, height } = detail;
      if (typeof width !== 'number' || typeof height !== 'number' || !Number.isFinite(width) || !Number.isFinite(height)
        || width < 0 || height < 0) return null;
      return { type: 'size', width: Math.min(Math.round(width), MAX_FRAME_SIZE), height: Math.min(Math.round(height), MAX_FRAME_SIZE) };
    }
    case 'error':
      return typeof detail.message === 'string' ? { type: 'error', message: detail.message.slice(0, 500) } : null;
    case 'probe': {
      const results: Record<string, string> = {};
      for (const [key, value] of Object.entries(detail)) {
        if (typeof value === 'string' && /^[a-zA-Z.]{1,64}$/u.test(key)) results[key] = value.slice(0, 200);
      }
      return { type: 'probe', results };
    }
    default:
      return null;
  }
}

/** Message the host posts into the frame. Sampled numbers only; no host data. */
export function motionFrameMessage(study: MotionStudy, frame: MotionFrame, nonce: string): unknown {
  return { channel: SANDBOX_CHANNEL, nonce, type: 'motion-frame', detail: { styles: frameToStyles(study, frame) } };
}
