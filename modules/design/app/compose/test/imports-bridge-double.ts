import { createHash } from 'node:crypto';
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
