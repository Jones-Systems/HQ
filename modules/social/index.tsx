import type { ModulePort } from '@hq/contracts';

/** R1 skeleton entry. SOC-C replaces it with the Social domain (task.social-domain.001). */
export function SocialModule({ context, destination }: ModulePort) {
  return <section className="module-slot" aria-labelledby="social-module-title">
    <span className="eyebrow">Social module</span>
    <h1 id="social-module-title">Social is available.</h1>
    <p>No Social workspace is connected yet. Drafts, the editorial calendar and research tools arrive as the Social lanes land.</p>
    <dl><dt>Project</dt><dd>{context.name}</dd><dt>Destination</dt><dd>{destination}</dd><dt>Status</dt><dd>Available · no data</dd></dl>
  </section>;
}
