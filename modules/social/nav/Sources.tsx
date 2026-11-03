import { StateView, StatusChip } from '@hq/ui';

export const SOURCES_PROPOSED = 'Proposed — needs the Social service source registry (SOC-6)';

/**
 * Sources is a reserved destination (RC-6). The source registry with provenance is a Social service
 * proposal that is held, so this page says so and is not built on fixtures as if it were delivered.
 */
export function Sources({ sourceId, navigate }: { readonly sourceId?: string; readonly navigate: (destination: string) => void }) {
  return (
    <div className="sd-page">
      <header className="sd-page-head">
        <h1>Sources</h1>
        <StatusChip tone="neutral" label="Proposed" detail="not built" />
      </header>
      {sourceId && (
        <p className="sd-note" role="note">The source “{sourceId}” can't be shown: there is no source registry yet.</p>
      )}
      <StateView
        state="unavailable" title={SOURCES_PROPOSED}
        description="Sources would list the data you supply, with its file, as-of date and the runs that used it. Until the Social service owner ships a source registry, each workbench run takes its input directly."
        action={{ label: 'Open workbenches', onAction: () => navigate('workbenches') }}
      />
      <section className="sd-card" aria-labelledby="sd-collection">
        <header className="sd-card-head">
          <h2 id="sd-collection">Collection</h2>
          <StatusChip tone="unavailable" label="Not available" />
        </header>
        <p>HQ never collects data from social platforms. The separate social-listening tool isn't connected to HQ.</p>
      </section>
    </div>
  );
}
