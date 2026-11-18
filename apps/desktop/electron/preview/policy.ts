export function previewTarget(value: unknown): URL | null {
  if (typeof value !== 'string' || value.length > 2048 || /\s|\\/.test(value)) return null;
  try {
    const url = new URL(value);
    return !url.username && !url.password && (url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) ? url : null;
  } catch { return null; }
}
function localAddress(host: string): boolean {
  return host === 'localhost' || host.endsWith('.local') || /^127\.|^10\.|^192\.168\.|^169\.254\.|^172\.(1[6-9]|2\d|3[01])\.|^0\./.test(host)
    || /^\[(::|::1|f[cd][0-9a-f:]*|fe[89ab][0-9a-f:]*|::ffff:.*)\]$/i.test(host);
}
export function requestAllowed(value: string, target: URL, mainFrame: boolean): boolean {
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return false;
    if (mainFrame && url.origin !== target.origin) return false;
    return url.origin === target.origin || !localAddress(url.hostname);
  } catch { return false; }
}
