import { hostId, type CatalogSnapshot, type HostId, type PreviewRef, type SourceAdapter } from '../contract.ts';

export const LOCAL_HOST_ID = hostId('laptop-local');

/** Main supplies this port; neither method accepts a filesystem path. */
export interface LocalCatalogPort {
  snapshot(signal: AbortSignal): Promise<CatalogSnapshot>;
  preview(ref: PreviewRef, signal: AbortSignal): Promise<Uint8Array>;
}

function abortable<T>(signal: AbortSignal, run: () => Promise<T>): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const aborted = () => { signal.removeEventListener('abort', aborted); reject(signal.reason); };
    signal.addEventListener('abort', aborted, { once: true });
    Promise.resolve().then(() => {
      signal.throwIfAborted();
      return run();
    }).then((value) => {
      signal.removeEventListener('abort', aborted);
      if (signal.aborted) reject(signal.reason); else resolve(value);
    }, (error: unknown) => {
      signal.removeEventListener('abort', aborted);
      reject(error);
    });
  });
}

export class LocalDirectoryAdapter implements SourceAdapter {
  readonly label = 'Local directory';
  readonly qualification = 'qualified' as const;
  readonly qualificationRef = 'hq.design.local-directory-adapter/v1';
  readonly #port: LocalCatalogPort;

  constructor(port: LocalCatalogPort) { this.#port = port; }

  listSnapshot(host: HostId, signal: AbortSignal): Promise<CatalogSnapshot> {
    return abortable(signal, async () => {
      if (host !== LOCAL_HOST_ID) throw new Error('Local catalog host is not supported');
      const snapshot = await this.#port.snapshot(signal);
      if (snapshot.hostId !== LOCAL_HOST_ID) throw new Error('Local catalog host mismatch');
      return snapshot;
    });
  }

  readPreview(ref: PreviewRef, signal: AbortSignal): Promise<Uint8Array> {
    return abortable(signal, () => this.#port.preview(ref, signal));
  }
}
