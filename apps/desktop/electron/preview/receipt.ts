import type { CaptureRecord } from '@hq/contracts/preview';

export interface CaptureReceiptFacts {
  readonly extent?: 'viewport' | 'full';
  readonly record: CaptureRecord;
  readonly observedUrl: string;
  readonly qualificationEnabled: boolean;
  readonly appVersion: string;
  readonly packaged: boolean;
  readonly byteLength: number;
  readonly pixelWidth: number;
  readonly pixelHeight: number;
  readonly persistedAt: string;
}

export function buildCaptureReceipt(facts: CaptureReceiptFacts) {
  const { record, byteLength, pixelWidth, pixelHeight, persistedAt } = facts;
  const { w, h, dpr } = record.viewport;
  if (dpr !== 1 && dpr !== 2 && dpr !== 3) throw new RangeError('Invalid capture DPR');
  if (facts.extent === 'full' && (record.scroll.x !== 0 || record.scroll.y !== 0
    || pixelWidth !== record.contentSize.w * dpr || pixelHeight !== record.contentSize.h * dpr)) {
    throw new RangeError('Invalid full capture geometry');
  }
  return {
    schema: 'hq.design.capture-evidence/v1',
    captureId: record.captureId,
    producer: { id: 'hq.electron-preview', contract: 1, mode: facts.qualificationEnabled ? 'qualification' : 'production',
      appVersion: facts.appVersion, packaged: facts.packaged },
    host: { sessionId: record.sessionId, hostVersionId: record.versionId, generation: record.generation },
    page: { origin: new URL(facts.observedUrl).origin, route: record.route, state: record.state },
    viewport: { w, h, dpr },
    scroll: { x: record.scroll.x, y: record.scroll.y },
    pageExtentCss: { width: record.contentSize.w, height: record.contentSize.h },
    imageRectCss: { x: record.scroll.x, y: record.scroll.y, width: w, height: h },
    ...(facts.extent === 'full' ? { imageRectCss: { x: 0, y: 0, width: record.contentSize.w, height: record.contentSize.h } } : {}),
    image: { mediaType: 'image/png', digest: record.captureDigest, byteLength, pixelWidth, pixelHeight },
    time: { capturedAt: record.capturedAt, basis: 'host-clock-after-coherence-before-persist', acquisition: null },
    persistedAt,
    fixture: { state: 'unknown', attestedBy: null },
  } as const;
}
