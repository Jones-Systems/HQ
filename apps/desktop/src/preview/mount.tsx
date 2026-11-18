import { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { PresentationShell } from '../PresentationShell';
import { DEFAULT_STATE, navigationKey } from '../state';
import { previewModules, PREVIEW_PRESENTATION, PREVIEW_REFERENCE_PROVIDERS } from './composition';
import { PreviewChrome } from './PreviewChrome';
import type { PreviewEntry } from './capabilities';
import '../styles.css';
import './preview.css';

export function mountPreview(entry: PreviewEntry, revision: string) {
  window.localStorage.setItem(navigationKey('hq-local'), JSON.stringify({ ...DEFAULT_STATE, domain: 'work' }));
  const modules = previewModules(entry);
  function Preview() {
    useEffect(() => { document.documentElement.dataset.previewState = 'ready'; }, []);
    return <PresentationShell modules={modules} presentation={PREVIEW_PRESENTATION} referenceProviders={PREVIEW_REFERENCE_PROVIDERS} />;
  }
  const onUncaughtError = () => { document.documentElement.dataset.previewState = 'failed'; };
  createRoot(document.getElementById('preview-chrome')!).render(<PreviewChrome revision={revision} />);
  createRoot(document.getElementById('root')!, { onUncaughtError }).render(<Preview />);
}
