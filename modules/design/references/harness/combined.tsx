import { createRoot } from 'react-dom/client';
import { ReferencesSection } from '../../app/sections/references/View.tsx';
import { createCombinedFixture } from './combined-fixture.ts';
import './combined.css';

declare const __HQD_CANDIDATE__: string;
const fixture = await createCombinedFixture();
const root = createRoot(document.getElementById('root')!);
const scheme = matchMedia('(prefers-color-scheme: dark)');
const appearance = () => { document.documentElement.dataset.theme = scheme.matches ? 'dark' : 'light'; };
appearance();
scheme.addEventListener('change', appearance);
window.addEventListener('pagehide', () => {
  root.unmount(); fixture.dispose(); scheme.removeEventListener('change', appearance);
}, { once: true });
(window as unknown as { __referencesHarness: unknown }).__referencesHarness = {
  candidate: __HQD_CANDIDATE__, label: fixture.label, env: fixture.env,
  get previewReads() { return fixture.previewReads; },
};
root.render(<>
  <p className="harness-label">Synthetic References section · in-memory fake storage · {__HQD_CANDIDATE__}</p>
  <ReferencesSection env={fixture.env} currentProject={{ id: 'proj_alpha', name: 'Alpha' }} />
</>);
