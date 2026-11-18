import { CAPABILITIES } from './capabilities';

export function PreviewChrome({ revision }: { revision: string }) {
  return <aside aria-label="Preview controls">
    <span data-preview-badge>Preview · synthetic data · {revision.slice(0, 7)}</span>
    <button data-preview-reset onClick={() => window.location.reload()}>Reset preview</button>
    <details data-preview-capabilities>
      <summary>Preview capabilities</summary>
      <p>Changes last only until this page reloads. Clipboard is unavailable on insecure origins.</p>
      <strong>Available</strong><ul>{CAPABILITIES.available.map(value => <li key={value}>{value}</li>)}</ul>
      <strong>Unavailable</strong><ul>{CAPABILITIES.unavailable.map(value => <li key={value}>{value}</li>)}</ul>
    </details>
  </aside>;
}
