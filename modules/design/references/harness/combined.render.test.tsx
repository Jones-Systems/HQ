import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import { ReferencesSection } from '../../app/sections/references/View.tsx';
import { createCombinedFixture } from './combined-fixture.ts';

test('the combined fixture exposes the real library, nonempty graph and screenshot import together', async () => {
  const fixture = await createCombinedFixture();
  try {
    const html = renderToStaticMarkup(<ReferencesSection env={fixture.env} currentProject={{ id: 'proj_alpha', name: 'Alpha' }} />);
    for (const label of ['3 references', 'Reference graph', 'Import screenshots', 'Sites, apps and their screens',
      'Pricing', 'Example Notes', 'Select a site, page, app, flow or screen.']) expect(html).toContain(label);
    expect(Object.values(fixture.env.library.state.references)).toHaveLength(3);
    expect(html).toContain('Choose a screenshot to import');
  } finally { fixture.dispose(); }
});
