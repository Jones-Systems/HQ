import { app, BrowserWindow, WebContentsView, session, type Session, type WebContents } from 'electron';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { allowedSender } from './services.js';
import { WINDOW_SECURITY } from './security.js';

export const EXPECTED_MAIN_PRELOAD = fileURLToPath(new URL('./preload.cjs', import.meta.url));
export type ContentsClass = 'hq-main' | 'hq-preview' | 'hq-component';
let synchronousRegistration = false;
let mainContents: WebContents | undefined;
const registry = new WeakMap<WebContents, ContentsClass>();
interface ContentsExpectation { kind: ContentsClass; session: Session; consumed?: WebContents }
let pending: ContentsExpectation | undefined;
export function contentsClass(contents: WebContents): ContentsClass | undefined { return registry.get(contents); }
function quarantine(contents: WebContents) {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-navigate', event => { if (!registry.has(contents)) event.preventDefault(); });
  contents.on('will-redirect', event => { if (!registry.has(contents)) event.preventDefault(); });
  setImmediate(() => { if (!registry.has(contents) && !contents.isDestroyed()) contents.close({ waitForBeforeUnload: false }); });
}
app.on('web-contents-created', (_event, contents) => {
  const expectation = pending;
  if (expectation && !expectation.consumed && contents.session === expectation.session) {
    expectation.consumed = contents; registry.set(contents, expectation.kind);
  } else quarantine(contents);
});
function construct<T extends { webContents: WebContents }>(kind: ContentsClass, target: Session, build: () => T): T {
  if (pending) throw Error('Nested contents construction');
  const expectation = { kind, session: target } as ContentsExpectation;
  pending = expectation;
  try {
    const value = build();
    if (expectation.consumed && expectation.consumed !== value.webContents) { quarantine(value.webContents); throw Error('Contents identity mismatch'); }
    synchronousRegistration = expectation.consumed === value.webContents;
    registry.set(value.webContents, kind);
    if (kind === 'hq-main') mainContents = value.webContents;
    value.webContents.once('destroyed', () => registry.delete(value.webContents));
    return value;
  } finally { pending = undefined; }
}
export function createMainWindow(): BrowserWindow {
  return construct('hq-main', session.defaultSession, () => new BrowserWindow({
    title: 'HQ', width: 1280, height: 820, minWidth: 760, minHeight: 560, backgroundColor: '#17191d',
    webPreferences: { ...WINDOW_SECURITY, preload: EXPECTED_MAIN_PRELOAD },
  }));
}
export const ISOLATED_PREFERENCES = {
  sandbox: true, contextIsolation: true, webSecurity: true,
  nodeIntegration: false, nodeIntegrationInSubFrames: false, webviewTag: false,
  allowRunningInsecureContent: false, experimentalFeatures: false, plugins: false,
  spellcheck: false, enableWebSQL: false, navigateOnDragDrop: false, disableDialogs: true,
} as const;
export function assertIsolatedPreferences(preferences: Record<string, unknown>) {
  if ('preload' in preferences || Object.entries(ISOLATED_PREFERENCES).some(([key, value]) => preferences[key] !== value)) throw Error('Isolated contents preferences refused');
}
export function createIsolatedContents(kind: 'hq-preview' | 'hq-component'): { view: WebContentsView; session: Session } {
  const target = session.fromPartition(`${kind}-${randomUUID()}`, { cache: false });
  if (target.getPreloadScripts().length !== 0 || target.getPreloads().length !== 0) throw Error('Session preloads prohibited');
  const preferences = { ...ISOLATED_PREFERENCES, session: target, devTools: !app.isPackaged };
  assertIsolatedPreferences(preferences);
  const view = construct(kind, target, () => new WebContentsView({ webPreferences: preferences }));
  return { view, session: target };
}

export async function probeUnregisteredContents(variant: 'same-preload' | 'altered-preferences') {
  if (app.isPackaged || !process.env.HQ_USER_DATA_DIR || process.env.HQ_QUALIFY_PREVIEW !== '1') throw Error('Qualification unavailable');
  if (!['same-preload', 'altered-preferences'].includes(variant)) throw Error('Invalid trust probe');
  if (variant === 'altered-preferences') {
    let refused = false;
    try { assertIsolatedPreferences({ ...ISOLATED_PREFERENCES, preload: EXPECTED_MAIN_PRELOAD }); } catch { refused = true; }
    return { registered: null, destroyed: true, constructed: false, alteredPreviewRefused: refused, synchronousRegistration, allowedSenderAccepted: false };
  }
  const window = new BrowserWindow({ show: false, webPreferences: { ...WINDOW_SECURITY, preload: EXPECTED_MAIN_PRELOAD } });
  const contents = window.webContents;
  const registered = contentsClass(contents) ?? null;
  const allowedSenderAccepted = mainContents ? allowedSender({ sender: contents, senderFrame: contents.mainFrame }, mainContents, mainContents.getURL(), null) : false;
  await new Promise<void>(resolve => {
    if (contents.isDestroyed()) { resolve(); return; }
    const finish = () => { clearTimeout(timeout); contents.removeListener('destroyed', finish); resolve(); };
    const timeout = setTimeout(finish, 2000);
    contents.once('destroyed', finish);
  });
  return { registered, destroyed: contents.isDestroyed(), constructed: true, alteredPreviewRefused: false, synchronousRegistration, allowedSenderAccepted };
}
