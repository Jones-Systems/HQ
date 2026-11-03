/**
 * Typed failure reports for the bridged Taste client (B3 backend contract, see BACKEND-CONTRACT.md).
 *
 * `reportTasteFailures` wraps a `TasteClientPort` so every rejection is classified with `classifyDesignError` and
 * handed to the caller as `designFeedback`, then rethrown unchanged: the Taste panel keeps its own behaviour
 * (it already treats a rejected save as unconfirmed and offers an idempotent retry). Renderer-safe.
 */
import type { TasteClientPort } from '../../taste/src/contract.ts';
import { classifyDesignError, designFeedback, type DesignFailureContext, type DesignFeedback } from './errors.ts';

/** Operation names, stable for tests and the toast meta line. */
export const TASTE_OPERATIONS = {
  load: { section: 'taste', operation: 'taste.load', action: 'load your taste ratings' },
  save: { section: 'taste', operation: 'taste.save', action: 'save to your taste journal', write: true },
  export: { section: 'taste', operation: 'taste.export', action: 'export your taste profile' },
} as const satisfies Readonly<Record<string, DesignFailureContext>>;
export type TasteOperation = keyof typeof TASTE_OPERATIONS;

/** `feedback` is null when the operation succeeded, so a notice for that operation can clear. */
export type TasteFailureReport = (operation: TasteOperation, feedback: DesignFeedback | null) => void;

export function reportTasteFailures(client: TasteClientPort, report: TasteFailureReport): TasteClientPort {
  async function guard<T>(operation: TasteOperation, run: () => Promise<T>): Promise<T> {
    try {
      const value = await run();
      report(operation, null);
      return value;
    } catch (error) {
      report(operation, designFeedback(classifyDesignError(error, TASTE_OPERATIONS[operation])));
      throw error;
    }
  }
  return Object.freeze<TasteClientPort>({
    label: client.label,
    snapshot: (projectId) => guard('load', () => client.snapshot(projectId)),
    submit: (command) => guard('save', () => client.submit(command)),
    exportProfile: (options) => guard('export', () => client.exportProfile(options)),
  });
}
