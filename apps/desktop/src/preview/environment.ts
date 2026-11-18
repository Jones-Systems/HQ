import { ENTRIES, type PreviewEntry } from './capabilities';

export function createMemoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear() { values.clear(); },
    getItem(key) { return values.get(String(key)) ?? null; },
    key(index) { return [...values.keys()][index] ?? null; },
    removeItem(key) { values.delete(String(key)); },
    setItem(key, value) { values.set(String(key), String(value)); },
  };
}

export function installRandomUUID(crypto: Crypto, secureContext: boolean): void {
  if (typeof crypto.randomUUID === 'function') return;
  if (secureContext) throw new Error('Secure-context randomUUID is unavailable.');
  if (typeof crypto.getRandomValues !== 'function') throw new Error('Secure random values are unavailable.');
  Object.defineProperty(crypto, 'randomUUID', { configurable: true, value: () => {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  } });
}

export function installEnvironment(target: Window, revision: string): PreviewEntry {
  const html = target.document.documentElement;
  html.dataset.previewSchema = 'jones-preview-session/v1';
  html.dataset.previewProduct = 'hq-desktop';
  html.dataset.previewRevision = revision;
  html.dataset.previewFixture = 'hq-examples@1';
  html.dataset.previewStorage = 'memory';
  html.dataset.previewSecureContext = String(target.isSecureContext === true);
  html.dataset.previewState = 'booting';
  const entry = target.document.querySelector('meta[name="jones-preview-entry"]')?.getAttribute('content');
  if (!ENTRIES.some(candidate => candidate.id === entry)) throw new Error('Unsupported preview entry.');
  html.dataset.previewEntry = entry!;
  if (!/^[a-f0-9]{40}$/.test(revision)) throw new Error('Missing source revision.');
  if ('hqServices' in target || 'hqDesktop' in target) throw new Error('Preview requires a browser without a desktop bridge.');
  const session = target.crypto.getRandomValues(new Uint8Array(16));
  html.dataset.previewSession = Array.from(session, byte => byte.toString(16).padStart(2, '0')).join('');
  // Do not read either original storage getter, even to test whether storage works.
  for (const key of ['localStorage', 'sessionStorage'] as const) {
    Object.defineProperty(target, key, { configurable: true, value: createMemoryStorage() });
  }
  installRandomUUID(target.crypto, target.isSecureContext === true);
  return entry as PreviewEntry;
}

export async function bootstrapPreview(target: Window, revision: string, mount: (entry: PreviewEntry) => Promise<void>): Promise<void> {
  try {
    const entry = installEnvironment(target, revision);
    await mount(entry);
  } catch (error) {
    target.document.documentElement.dataset.previewState = 'failed';
    const message = target.document.createElement('p');
    message.setAttribute('role', 'alert');
    message.textContent = `Preview could not start: ${error instanceof Error ? error.message : 'Environment unavailable.'}`;
    target.document.getElementById('root')?.replaceChildren(message);
  }
}
