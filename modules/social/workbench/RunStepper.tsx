import type { ObservedRunStatus, RunStatus } from '../core';
import { SocialIcon } from '../ui';

type StepState = 'pending' | 'done' | 'active' | 'failed' | 'unknown';

interface Step {
  readonly id: 'queued' | 'running' | 'finished';
  readonly label: string;
  readonly state: StepState;
}

const STATE_WORD: { readonly [S in StepState]: string } = { pending: 'not reached yet', done: 'done', active: 'in progress', failed: 'ended here', unknown: 'status unknown' };

/**
 * The run's steps. The last step names how the run ended and says "Finished" until it has; an outcome that has not
 * happened is never shown. A run last seen active whose status can no longer be read ends in Unknown, because
 * nothing past the last read is known.
 */
export function runSteps(status: ObservedRunStatus, lastSeen?: RunStatus): readonly Step[] {
  const seen = status === 'unknown' ? lastSeen ?? 'queued' : status;
  const queued: Step = { id: 'queued', label: 'Queued', state: seen === 'queued' && status !== 'unknown' ? 'active' : 'done' };
  switch (status) {
    case 'queued': return [queued, { id: 'running', label: 'Running', state: 'pending' }, { id: 'finished', label: 'Finished', state: 'pending' }];
    case 'running': return [queued, { id: 'running', label: 'Running', state: 'active' }, { id: 'finished', label: 'Finished', state: 'pending' }];
    case 'succeeded': return [queued, { id: 'running', label: 'Running', state: 'done' }, { id: 'finished', label: 'Succeeded', state: 'done' }];
    case 'failed': return [queued, { id: 'running', label: 'Running', state: 'done' }, { id: 'finished', label: 'Failed', state: 'failed' }];
    // A restart interrupts queued and running runs alike, so it cannot say whether the run had started.
    case 'interrupted': return [queued, { id: 'running', label: 'Running', state: 'pending' }, { id: 'finished', label: 'Interrupted', state: 'failed' }];
    case 'unknown': return [queued, { id: 'running', label: 'Running', state: seen === 'running' ? 'done' : 'pending' }, { id: 'finished', label: 'Unknown', state: 'unknown' }];
  }
}

/**
 * Queued → Running → Succeeded, Failed, Interrupted or Unknown, on the shared `sx-stepper`. The connector fills as
 * a step completes, the active step pulses and the last step's word cross-fades into the outcome. Motion comes from
 * `social-ui.css` and the `@hq/ui` tokens, so reduced motion shows each change at once.
 */
export function RunStepper({ status, lastSeen }: { readonly status: ObservedRunStatus; readonly lastSeen?: RunStatus }) {
  const steps = runSteps(status, lastSeen);
  return (
    <ol className="sx-stepper sw-stepper" aria-label="Run progress" data-status={status}>
      {steps.map((step, index) => (
        <StepItem key={step.id} step={step} first={index === 0} outcome={step.id === 'finished' ? status : undefined} />
      ))}
    </ol>
  );
}

function StepItem({ step, first, outcome }: { readonly step: Step; readonly first: boolean; readonly outcome: ObservedRunStatus | undefined }) {
  return (
    <>
      {!first && <li className="sx-step-line" aria-hidden="true" />}
      <li
        className="sx-step" aria-current={step.state === 'active' ? 'step' : undefined}
        data-state={step.state === 'pending' ? undefined : step.state} data-step={step.id} data-outcome={outcome === 'interrupted' ? 'interrupted' : undefined}
      >
        <span className="sx-step-dot" aria-hidden="true">
          {step.state === 'done' && <SocialIcon name="check" />}
          {step.state === 'failed' && <SocialIcon name="close" />}
          {step.state === 'unknown' && <span className="sw-step-mark">?</span>}
        </span>
        {/* Keyed by its word, so the last step fades into "Succeeded", "Failed" or "Unknown" instead of snapping. */}
        <span key={step.label} className="sx-step-label hq-enter-fade">{step.label}</span>
        <span className="hq-sr-only">, {STATE_WORD[step.state]}</span>
      </li>
    </>
  );
}
