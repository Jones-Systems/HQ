import type { DesignServiceTransport, DesignServiceRoute, DesignServiceParams, DesignServiceValues, DesignStorageResult, StoredDocument } from '@hq/contracts/services';
import { authoringDigest } from '../canonical.ts';

export function createTransportDouble() {
  const documents = new Map<string, StoredDocument>();
  const calls: { route: DesignServiceRoute; params: DesignServiceParams[DesignServiceRoute] }[] = [];
  let failure: ((route: DesignServiceRoute, params: DesignServiceParams[DesignServiceRoute]) => unknown) | null = null;
  const transport: DesignServiceTransport = {
    async call<R extends DesignServiceRoute>(route: R, params: DesignServiceParams[R]): Promise<DesignStorageResult<DesignServiceValues[R]>> {
      calls.push({ route, params: structuredClone(params) });
      const failed = failure?.(route, params);
      if (failed !== undefined && failed !== null) return failed as DesignStorageResult<DesignServiceValues[R]>;
      let value: DesignServiceValues[DesignServiceRoute];
      if (route === 'doc.list') {
        const { prefix } = params as DesignServiceParams['doc.list'];
        value = [...documents.keys()].filter((key) => key.startsWith(prefix)).sort();
      } else if (route === 'doc.put') {
        const input = params as DesignServiceParams['doc.put'];
        const old = documents.get(input.key);
        if (input.expectedRevision !== undefined && input.expectedRevision !== (old?.revision ?? null)) return { ok: false, kind: 'conflict' };
        value = { namespace: 'workspace', key: input.key, revision: (old?.revision ?? 0) + 1, valueDigest: await authoringDigest(input.value), updatedAt: '2026-01-01T00:00:00Z', value: structuredClone(input.value) };
        documents.set(input.key, value);
      } else {
        value = documents.get((params as DesignServiceParams['doc.get']).key) ?? null;
      }
      return { ok: true, value: structuredClone(value) as DesignServiceValues[R] };
    },
  };
  return { transport, documents, calls, failWith: (next: typeof failure) => { failure = next; } };
}
