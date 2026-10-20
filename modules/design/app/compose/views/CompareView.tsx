import { useState } from 'react';
import type { DesignSectionProps } from '../../../ui/contract.ts';
import { CompareWorkspace } from '../../../compare/src/view/index.tsx';
import { FAKE_TAG, SYNTHETIC_TAG } from '../labels.ts';
import { compareFor } from '../workspace.ts';
import { AnnotationSlot, type DrawTool } from './AnnotationSlot.tsx';
import { SectionFrame } from './SectionFrame.tsx';

const TOOLS: readonly (readonly [DrawTool | null, string])[] = [[null, 'No tool'], ['box', 'Box'], ['arrow', 'Arrow'], ['ink', 'Ink'], ['eraser', 'Eraser']];

/** Compare with annotations in its overlay slot: marks attach to the exact static capture of each panel. */
export function CompareView({ context }: DesignSectionProps) {
  const [tool, setTool] = useState<DrawTool | null>(null);
  return <SectionFrame lane="T4 compare + T5 annotations" entry="compare/src/view › CompareWorkspace (renderOverlay → annotations overlay)" tags={[FAKE_TAG, SYNTHETIC_TAG]}
    notes={['synthetic captures and labelled fake previews (no host surface)', 'marks need a static capture; live previews cannot be annotated']}>
    <div className="hqd-compose-tools" role="toolbar" aria-label="Annotation tool for compare panels">
      {TOOLS.map(([id, label]) => <button key={label} type="button" aria-pressed={tool === id} onClick={() => setTool(id)}>{label}</button>)}
    </div>
    <CompareWorkspace controller={compareFor(context)} renderOverlay={(frame) => <AnnotationSlot frame={frame} tool={tool} />} />
  </SectionFrame>;
}
