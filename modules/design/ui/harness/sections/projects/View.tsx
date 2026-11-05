import type { DesignSectionProps } from '../../../contract.ts';

/** LABELLED FAKE projects list: a reference into another project only proposes a switch. */
export function FakeProjects({ context, proposeProjectSwitch }: DesignSectionProps) {
  return <div className="fake-section" data-fake-section="projects">
    <p className="fake-label">FAKE projects fixture. Current project: {context.name}.</p>
    <ul>
      <li><button type="button" data-testid="open-foreign-reference" onClick={() => proposeProjectSwitch('beta', 'Beta site')}>
        Open “Hero v2” (in project Beta site)
      </button></li>
    </ul>
  </div>;
}
