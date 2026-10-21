/**
 * Saved flow screens name their capture by digest. The desktop preview host stores each coherent
 * capture's PNG in the Design blob store under that same digest, so a screen's image is read back by
 * exact digest only. Bytes are re-hashed here; nothing is matched by route, title or recency.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Screen, ScreenPreviewPort } from '../../flows/src/contract.ts';
import { sha256Hex } from './canonical.ts';

export type CaptureReader = (digest: string) => Promise<Uint8Array | null>;
export type CaptureState = { readonly status: 'loading' } | { readonly status: 'ready'; readonly url: string } | { readonly status: 'missing' | 'unreadable' };

const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export const CAPTURE_REASONS = {
  none: 'No capture was saved for this screen.',
  loading: 'Loading the saved capture…',
  missing: 'The saved capture image is not stored on this device.',
  unreadable: 'The saved capture image could not be read.',
  unavailable: 'Saved capture images are unavailable here.',
} as const;

/** Reads one capture by exact digest; bytes must be a PNG whose SHA-256 is that digest. */
export async function readCapture(read: CaptureReader, digest: string): Promise<CaptureState> {
  try {
    const bytes = await read(digest);
    if (bytes === null) return { status: 'missing' };
    if (!PNG.every((byte, n) => bytes[n] === byte) || `sha256:${await sha256Hex(bytes)}` !== digest) return { status: 'unreadable' };
    return { status: 'ready', url: URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'image/png' })) };
  } catch { return { status: 'unreadable' }; }
}

/** One serial reader per mounted view; object URLs are revoked when the view unmounts. */
export function useFlowCapturePreviews(screens: readonly Screen[], read: CaptureReader | null): ScreenPreviewPort {
  const [captures, setCaptures] = useState<ReadonlyMap<string, CaptureState>>(new Map());
  const urls = useRef(new Set<string>());
  const requested = useRef(new Set<string>());
  const mounted = useRef(true);
  const digests = useMemo(() => [...new Set(screens.map((screen) => screen.captureDigest).filter((digest): digest is string => digest !== undefined && DIGEST.test(digest)))].sort(), [screens]);
  const wanted = digests.join(',');
  useEffect(() => {
    if (!read) return;
    const pending = digests.filter((digest) => !requested.current.has(digest));
    if (pending.length === 0) return;
    for (const digest of pending) requested.current.add(digest);
    setCaptures((previous) => new Map([...previous, ...pending.map((digest) => [digest, { status: 'loading' } as const] as const)]));
    // Reads finish even when more screens arrive; only unmounting discards their results.
    void (async () => {
      for (const digest of pending) {
        const state = await readCapture(read, digest);
        if (!mounted.current) { if (state.status === 'ready') URL.revokeObjectURL(state.url); return; }
        if (state.status === 'ready') urls.current.add(state.url);
        setCaptures((previous) => new Map(previous).set(digest, state));
      }
    })();
  }, [wanted, read]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; for (const url of urls.current) URL.revokeObjectURL(url); urls.current.clear(); };
  }, []);
  return useMemo((): ScreenPreviewPort => ({
    label: read ? 'Saved captures on this device' : 'Saved capture images unavailable',
    previewUrl(screen) {
      const state = screen.captureDigest === undefined ? undefined : captures.get(screen.captureDigest);
      return state?.status === 'ready' ? state.url : null;
    },
    unavailableReason(screen) {
      if (screen.captureDigest === undefined || !DIGEST.test(screen.captureDigest)) return CAPTURE_REASONS.none;
      if (!read) return CAPTURE_REASONS.unavailable;
      const state = captures.get(screen.captureDigest);
      return state === undefined || state.status === 'loading' ? CAPTURE_REASONS.loading : state.status === 'ready' ? '' : CAPTURE_REASONS[state.status];
    },
  }), [captures, read]);
}
