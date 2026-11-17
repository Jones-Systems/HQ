import { createHash } from 'node:crypto';
import zlib from 'node:zlib';
import type { DesignServiceTransport, DesignServiceRoute, DesignServiceParams, DesignServiceValues, DesignStorageResult, ImportPickResult } from '@hq/contracts/services';
import { authoringDigest } from '../canonical.ts';
import { createTransportDouble } from './bridge-double.ts';

type Params = DesignServiceParams[DesignServiceRoute];
const sha = (bytes: Uint8Array) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

/**
 * A transport double with the host's import semantics: documents, an `imports` event journal, blobs by digest and an
 * atomic `import.commit` with compare-and-swap on revisions and event sequence. It validates nothing about key roots;
 * the real host's allowlist is covered by the desktop host tests. Params and results are structured-cloned, like IPC.
 */
export function createImportsDouble() {
  const base = createTransportDouble();
  const blobs = new Map<string, Uint8Array>();
  const events = new Map<string, { seq: number; payload: unknown }[]>();
  const calls: { route: DesignServiceRoute; params: Params }[] = [];
  const commits: DesignServiceParams['import.commit'][] = [];
  let pickResult: ImportPickResult = { status: 'canceled' };
  let fault: ((route: DesignServiceRoute, params: Params) => unknown) | null = null;
  let lostAfterCommit = false;

  const transport: DesignServiceTransport = {
    async call<R extends DesignServiceRoute>(route: R, params: DesignServiceParams[R]): Promise<DesignStorageResult<DesignServiceValues[R]>> {
      calls.push({ route, params: structuredClone(params) });
      const injected = fault?.(route, params);
      if (injected !== undefined && injected !== null) return injected as DesignStorageResult<DesignServiceValues[R]>;
      const ok = (value: unknown) => ({ ok: true as const, value: structuredClone(value) }) as DesignStorageResult<DesignServiceValues[R]>;
      switch (route) {
        case 'import.pick': return ok(pickResult);
        case 'blob.has': return ok(blobs.has((params as DesignServiceParams['blob.has']).digest));
        case 'blob.get': { const bytes = blobs.get((params as DesignServiceParams['blob.get']).digest); return ok(bytes ? new Uint8Array(bytes) : null); }
        case 'event.read': return ok({ events: events.get((params as DesignServiceParams['event.read']).stream) ?? [], status: { state: 'ok' } });
        case 'import.commit': {
          const { ops } = structuredClone(params) as DesignServiceParams['import.commit'];
          commits.push({ ops });
          for (const op of ops) {
            if (op.op === 'put-document') {
              const current = base.documents.get(op.key);
              if ((current === undefined ? null : String(current.revision)) !== op.expectedRevision) return { ok: false, kind: 'conflict' } as DesignStorageResult<DesignServiceValues[R]>;
            } else if (op.op === 'append-event') {
              if ((events.get(op.stream)?.length ?? 0) !== op.expectedSeq) return { ok: false, kind: 'conflict' } as DesignStorageResult<DesignServiceValues[R]>;
            } else if (sha(op.bytes) !== op.digest) return { ok: false, kind: 'invalid' } as DesignStorageResult<DesignServiceValues[R]>;
          }
          for (const op of ops) {
            if (op.op === 'put-document') {
              const old = base.documents.get(op.key);
              base.documents.set(op.key, { namespace: 'workspace', key: op.key, revision: (old?.revision ?? 0) + 1, valueDigest: await authoringDigest(op.value),
                updatedAt: '2026-01-01T00:00:00Z', value: structuredClone(op.value) });
            } else if (op.op === 'append-event') {
              const stream = events.get(op.stream) ?? [];
              stream.push({ seq: stream.length + 1, payload: structuredClone(op.payload) });
              events.set(op.stream, stream);
            } else blobs.set(op.digest, new Uint8Array(op.bytes));
          }
          // The commit is durable, but the answer never arrives: the renderer cannot tell.
          if (lostAfterCommit) { lostAfterCommit = false; throw new Error('IPC channel closed'); }
          return ok({ txnId: createHash('sha256').update(JSON.stringify(ops.length)).digest('hex') });
        }
        default: return base.transport.call(route, params);
      }
    },
  };
  return {
    transport, documents: base.documents, blobs, events, calls, commits,
    setPick: (next: ImportPickResult) => { pickResult = next; },
    failWith: (next: typeof fault) => { fault = next; },
    /** The next commit lands, but its reply is lost. */
    loseNextCommitReply: () => { lostAfterCommit = true; },
    count: (route: DesignServiceRoute) => calls.filter((call) => call.route === route).length,
  };
}

/** A minimal structurally valid PNG (signature and IHDR) of any size; the seed varies the content. Synthetic only. */
export function syntheticImportPng(width: number, height: number, seed = 0): Uint8Array {
  const bytes = new Uint8Array(41);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(bytes.buffer).setUint32(16, width);
  new DataView(bytes.buffer).setUint32(20, height);
  bytes.set([8, 6, 0, 0, 0], 24);
  bytes[40] = seed;
  return bytes;
}

// ------------------------------------------------------------------------------ real PNG builder (test-only)

export type BuiltPngColorType = 0 | 2 | 3 | 4 | 6;
export const PNG_CHANNELS: Readonly<Record<BuiltPngColorType, number>> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

export interface BuiltPngOptions {
  readonly width: number;
  readonly height: number;
  /** Default 6 (RGBA). */
  readonly colorType?: BuiltPngColorType;
  /** IHDR bit depth. Default 8. Anything else only changes the header: the image data is still written as 8-bit. */
  readonly depth?: number;
  /** IHDR interlace method. Default 0. Anything else only changes the header. */
  readonly interlace?: number;
  /** Unfiltered samples, `width * height * channels` bytes. Default: seeded noise. */
  readonly samples?: Uint8Array;
  readonly seed?: number;
  /** Filter type applied to every scanline. Default 0. */
  readonly filter?: 0 | 1 | 2 | 3 | 4;
  /** Palette as RGB triples (colour type 3). */
  readonly palette?: Uint8Array;
  /** A tRNS chunk, written after PLTE. */
  readonly trns?: Uint8Array;
  /** Split the zlib stream across this many IDAT chunks. Default 1. */
  readonly idatChunks?: number;
  readonly level?: number;
  /** Changes the raw (filtered, uncompressed) scanline bytes before they are compressed. */
  readonly rawTransform?: (raw: Uint8Array) => Uint8Array;
  /** Changes the compressed zlib stream before it is split into IDAT chunks. */
  readonly zlibTransform?: (stream: Uint8Array) => Uint8Array;
  /** Extra chunks written right before the first IDAT. */
  readonly extraChunks?: readonly { readonly type: string; readonly data: Uint8Array }[];
  readonly omitIend?: boolean;
}

/** Deterministic noise (xorshift32): incompressible, identical on every run. */
export function noiseSamples(length: number, seed = 1): Uint8Array {
  const out = new Uint8Array(length);
  let state = (seed * 2654435761 + 1) >>> 0 || 1;
  for (let i = 0; i < length; i += 1) {
    state ^= state << 13; state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5; state >>>= 0;
    out[i] = state & 0xff;
  }
  return out;
}

const paethPredictor = (a: number, b: number, c: number): number => {
  const p = a + b - c;
  const [pa, pb, pc] = [Math.abs(p - a), Math.abs(p - b), Math.abs(p - c)];
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

/** Scanlines of `samples` with filter type `type` on every row (the reverse of what a decoder does). */
export function filterScanlines(samples: Uint8Array, width: number, height: number, channels: number, type: number): Uint8Array {
  const stride = width * channels;
  const out = new Uint8Array(height * (1 + stride));
  for (let y = 0; y < height; y += 1) {
    out[y * (1 + stride)] = type;
    for (let i = 0; i < stride; i += 1) {
      const x = samples[y * stride + i]!;
      const left = i >= channels ? samples[y * stride + i - channels]! : 0;
      const up = y > 0 ? samples[(y - 1) * stride + i]! : 0;
      const upLeft = y > 0 && i >= channels ? samples[(y - 1) * stride + i - channels]! : 0;
      const predicted = type === 0 ? 0 : type === 1 ? left : type === 2 ? up : type === 3 ? (left + up) >> 1 : paethPredictor(left, up, upLeft);
      out[y * (1 + stride) + 1 + i] = (x - predicted) & 0xff;
    }
  }
  return out;
}

/** One PNG chunk (length, type, data, CRC-32). */
export function pngChunkBytes(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(Buffer.from(type, 'latin1'), 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, zlib.crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** A real, decodable PNG built with `node:zlib` (the encoder is independent of the code under test). */
export function buildPng(options: BuiltPngOptions): Uint8Array {
  const { width, height } = options;
  const colorType = options.colorType ?? 6;
  const channels = PNG_CHANNELS[colorType];
  const samples = options.samples ?? noiseSamples(width * height * channels, options.seed ?? 1);
  if (samples.length !== width * height * channels) throw new Error('samples do not match the image size');
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr.set([options.depth ?? 8, colorType, 0, 0, options.interlace ?? 0], 8);
  let raw = filterScanlines(samples, width, height, channels, options.filter ?? 0);
  if (options.rawTransform !== undefined) raw = options.rawTransform(raw);
  let stream: Uint8Array = zlib.deflateSync(raw, { level: options.level ?? 1 });
  if (options.zlibTransform !== undefined) stream = options.zlibTransform(stream);
  const chunks: Uint8Array[] = [Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), pngChunkBytes('IHDR', ihdr)];
  if (options.palette !== undefined) chunks.push(pngChunkBytes('PLTE', options.palette));
  if (options.trns !== undefined) chunks.push(pngChunkBytes('tRNS', options.trns));
  for (const extra of options.extraChunks ?? []) chunks.push(pngChunkBytes(extra.type, extra.data));
  const parts = Math.max(1, Math.min(options.idatChunks ?? 1, stream.length));
  const size = Math.ceil(stream.length / parts);
  for (let start = 0; start < stream.length; start += size) chunks.push(pngChunkBytes('IDAT', stream.subarray(start, start + size)));
  if (options.omitIend !== true) chunks.push(pngChunkBytes('IEND', new Uint8Array(0)));
  const out = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let at = 0;
  for (const chunk of chunks) { out.set(chunk, at); at += chunk.length; }
  return out;
}

/** A real RGBA noise PNG larger than the 2 MiB Projects thumbnail cap (about 2.16 MB). Synthetic only. */
export function largeImportPng(seed = 1, width = 900, height = 600): Uint8Array {
  const png = buildPng({ width, height, seed });
  if (png.byteLength <= 2 * 1024 * 1024) throw new Error('the large test PNG must exceed the 2 MiB thumbnail cap');
  return png;
}
