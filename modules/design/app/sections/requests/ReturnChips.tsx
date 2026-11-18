import { StatusChip } from '@hq/ui';
import type { ReturnedCandidate } from '../../../requests/src/contract.ts';
import { returnCounts } from '../runs/pipeline.ts';

/**
 * How returned work got here, as compact chips. The four kinds stay distinct and none of them is native
 * verification: agent-reported and owner-reported returns say so, and the native count stays at what was observed.
 */
export function ReturnChips({ candidates }: { readonly candidates: readonly ReturnedCandidate[] }) {
  const counts = returnCounts(candidates);
  return <div className="hqd-return-provenance">
    <ul className="hqd-return-chips" aria-label="Return provenance">
      <li><StatusChip tone="info" label="Simulated" detail={String(counts.simulated)} /></li>
      <li><StatusChip tone="warning" label="Agent-reported" detail={String(counts.agentReported)} /></li>
      <li><StatusChip tone="neutral" label="Owner-reported" detail={String(counts.ownerReported)} /></li>
      <li><StatusChip tone={counts.realVerified > 0 ? 'success' : 'neutral'} label="Natively verified" detail={String(counts.realVerified)} /></li>
    </ul>
    <p>Agent-reported and owner-reported returns are not native verification.</p>
  </div>;
}
