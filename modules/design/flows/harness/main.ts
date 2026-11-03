/**
 * Dev-only browser harness with the synthetic fixture. Not part of the module entry; delete
 * freely. Run from the HQ root: `npx vite modules/design/flows/harness --host 127.0.0.1`.
 */
import { createElement as h } from 'react';
import { createRoot } from 'react-dom/client';
import { FlowsWorkspace } from '../src/views.ts';
import { checkout } from '../test/fixtures.ts';

createRoot(document.getElementById('root')!).render(h(FlowsWorkspace, { flow: checkout() }));
