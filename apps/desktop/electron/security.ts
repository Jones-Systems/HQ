export const DEVELOPMENT_URL = 'http://127.0.0.1:5173';

export function validateDevelopmentUrl(value: string | undefined, packaged: boolean): string | null {
  if (value === undefined) return null;
  if (packaged || value !== DEVELOPMENT_URL) throw new Error('HQ only accepts its exact loopback development URL.');
  return value;
}

export const WINDOW_SECURITY = {
  contextIsolation: true,
  sandbox: true,
  nodeIntegration: false,
  webviewTag: false,
  webSecurity: true,
} as const;
