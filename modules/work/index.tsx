import type { ModulePort } from '@hq/contracts';

/** R1 skeleton entry. WRK-B replaces it with the Work domain (task.work-domain.001). */
export function WorkModule({ context, destination }: ModulePort) {
  return <section className="module-slot" aria-labelledby="work-module-title">
    <span className="eyebrow">Work module</span>
    <h1 id="work-module-title">Work is available.</h1>
    <p>No Planner is connected yet. The board, planning views and card details arrive as the Work lanes land.</p>
    <dl><dt>Project</dt><dd>{context.name}</dd><dt>Destination</dt><dd>{destination}</dd><dt>Status</dt><dd>Available · no data</dd></dl>
  </section>;
}
