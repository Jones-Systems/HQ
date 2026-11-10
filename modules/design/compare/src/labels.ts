/**
 * Source labelling. A static capture and a live preview never share a badge,
 * a fake preview never reads as qualified, and a browser capture never reads
 * as native evidence.
 */
import type { PreviewQualification, StaticCapture } from './contract.ts';
import type { PanelRole, PanelSource } from './model.ts';
import { describeViewport } from './presets.ts';

export type EvidenceClass =
  | 'browser-capture' | 'native-device-capture' | 'native-simulator-capture'
  | 'live-preview' | 'live-preview-fake' | 'unresolved';

export interface SourceLabel {
  readonly badge: 'Static capture' | 'Live preview';
  readonly evidence: EvidenceClass;
  /** One line, e.g. "Browser capture · 390 × 844 @3x · 2026-10-19 14:02 UTC". */
  readonly detail: string;
  /** Explicit caveats that must stay visible beside the panel. */
  readonly caveats: readonly string[];
}

export const ROLE_LABELS: Readonly<Record<PanelRole, string>> = { baseline: 'Baseline', candidate: 'Candidate', reference: 'Reference' };

const ORIGIN_TEXT: Readonly<Record<StaticCapture['origin'], { evidence: EvidenceClass; text: string }>> = {
  'browser': { evidence: 'browser-capture', text: 'Browser capture' },
  'native-device': { evidence: 'native-device-capture', text: 'Native device capture' },
  'native-simulator': { evidence: 'native-simulator-capture', text: 'Native simulator capture' },
};

export function formatCapturedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'capture time unknown';
  return `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

export function labelStatic(capture: StaticCapture | null): SourceLabel {
  if (capture === null) {
    return { badge: 'Static capture', evidence: 'unresolved', detail: 'Capture record unavailable', caveats: ['The pinned capture could not be resolved; nothing else is shown in its place.'] };
  }
  const origin = ORIGIN_TEXT[capture.origin];
  const caveats: string[] = ['Frozen bytes: shows the version as captured, not as it renders now.'];
  if (capture.origin === 'browser') caveats.push('Browser capture; not native evidence.');
  if (capture.origin === 'native-simulator') caveats.push('Simulator capture; not device evidence.');
  if (capture.fixture) caveats.push('Synthetic fixture.');
  return {
    badge: 'Static capture', evidence: origin.evidence,
    detail: `${origin.text} · ${describeViewport(capture.viewport)} · ${formatCapturedAt(capture.capturedAt)}`, caveats,
  };
}

export function labelLive(qualification: PreviewQualification | null, capabilityLabel: string | null): SourceLabel {
  if (qualification === 'qualified') {
    return {
      badge: 'Live preview', evidence: 'live-preview', detail: capabilityLabel ?? 'Qualified preview',
      caveats: ['Live rendering; may differ from any frozen capture.'],
    };
  }
  return {
    badge: 'Live preview', evidence: 'live-preview-fake',
    detail: qualification === 'labelled-fake' ? `${capabilityLabel ?? 'Fake preview'} · labelled fake` : 'Preview unavailable',
    caveats: qualification === 'labelled-fake'
      ? ['Labelled fake: synthetic content, not a qualified preview of this version.']
      : ['No preview capability is connected; no capture is substituted.'],
  };
}

export function labelSource(source: PanelSource, capture: StaticCapture | null, qualification: PreviewQualification | null, capabilityLabel: string | null): SourceLabel {
  return source.kind === 'static-capture' ? labelStatic(capture) : labelLive(qualification, capabilityLabel);
}
