import { STEPS, type StepProgress } from './model.ts';

/**
 * Draft → Clarify → Freeze → Review. A line fills up to the current step as the request moves; finished steps
 * show a check and say so in words, so progress never depends on colour. The fill is a pseudo-element that
 * transitions on `data-position`, so under reduced motion it simply jumps.
 */
export function RequestStepper({ progress }: { readonly progress: StepProgress }) {
  return <ol className="hqr-steps" aria-label="Request progress" data-position={progress.index}>
    {STEPS.map((step, index) => {
      const done = progress.completed.includes(step);
      const current = step === progress.current;
      return <li key={step} className="hqr-step" data-done={done} data-current={current}
        aria-current={current ? 'step' : undefined}>
        <span className="hqr-step-marker" aria-hidden="true">
          {done
            ? <svg viewBox="0 0 16 16"><path d="m4 8.5 2.6 2.6L12 5.6" /></svg>
            : <span>{index + 1}</span>}
        </span>
        <span className="hqr-step-label">{step}</span>
        {done && <span className="hq-sr-only">, done</span>}
        {current && progress.detail && <span className="hqr-step-detail">{progress.detail}</span>}
      </li>;
    })}
  </ol>;
}
