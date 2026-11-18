// What a session needs before it can start, and the exact command that fixes each gap.
// Nothing here installs system packages or uses sudo.
import { spawn } from 'node:child_process';
import { access, constants } from 'node:fs/promises';
import { delimiter, join } from 'node:path';

/** Shell-quotes a path for the fix commands we print. */
export function quote(text) {
  return /^[\w@%+=:,./-]+$/.test(text) ? text : `'${text.replaceAll("'", `'\\''`)}'`;
}

export async function findExecutable(name, searchPath = process.env.PATH ?? '') {
  for (const directory of searchPath.split(delimiter).filter(Boolean)) {
    try { await access(join(directory, name), constants.X_OK); return join(directory, name); } catch { /* next */ }
  }
  return null;
}

export const electronBinary = (repo, platform = process.platform) => join(repo, 'node_modules/electron/dist',
  platform === 'darwin' ? 'Electron.app/Contents/MacOS/Electron' : 'electron');
export const electronInstaller = repo => join(repo, 'node_modules/electron/install.js');
export const desktopMain = repo => join(repo, 'apps/desktop/dist-electron/main.js');
export const desktopRenderer = repo => join(repo, 'apps/desktop/dist/index.html');

const exists = async (path, mode = constants.F_OK) => { try { await access(path, mode); return true; } catch { return false; } };

/**
 * Problems that stop a session from starting, each `{ code, message, fix }`. `fix` is a command to
 * run, or `null` when only the host owner can resolve it (system packages, an unsupported OS).
 */
export async function checkPrerequisites(repo, { mode = 'example', platform = process.platform, searchPath } = {}) {
  const problems = [];
  if (!['linux', 'darwin'].includes(platform)) {
    return [{ code: 'platform', message: `dev-preview supports Linux (Xvfb/bubblewrap) and Darwin (native Electron) only (this host: ${platform})`, fix: null }];
  }
  const where = quote(repo);
  const dependenciesPresent = await exists(join(repo, 'node_modules/electron/package.json'));
  if (!dependenciesPresent) {
    problems.push({ code: 'dependencies', message: `Dependencies are not installed in ${repo}`, fix: `cd ${where} && npm ci --ignore-scripts --no-audit --no-fund` });
  } else if (!await exists(electronBinary(repo, platform), constants.X_OK)) {
    problems.push({
      code: 'electron-binary',
      message: `Electron binary missing: ${electronBinary(repo, platform)} (npm ci --ignore-scripts skips Electron's download)`,
      fix: `cd ${where} && node node_modules/electron/install.js    # or rerun with --install-electron`,
    });
  }
  if (!await exists(desktopMain(repo)) || !await exists(desktopRenderer(repo))) {
    problems.push({ code: 'build', message: `The desktop app is not built in ${repo}`, fix: `cd ${where} && npm run build` });
  }
  for (const tool of [...(platform === 'linux' ? ['Xvfb', 'bwrap'] : []), ...(mode === 'live' ? ['python3'] : [])]) {
    if (!await findExecutable(tool, searchPath)) {
      problems.push({ code: `tool-${tool.toLowerCase()}`, message: `${tool} is required but was not found on PATH`, fix: null });
    }
  }
  return problems;
}

export function formatProblems(problems) {
  return problems.map(({ message, fix }) => `- ${message}${fix ? `\n    fix: ${fix}` : ''}`).join('\n');
}

export class PrerequisiteError extends Error {
  constructor(problems) {
    super(`Cannot start a dev-preview session:\n${formatProblems(problems)}`);
    this.name = 'PrerequisiteError';
    this.problems = problems;
  }
}

/**
 * Runs the Electron package's own installer: default shared download cache, checksum verified by
 * the package. The skip flag that `npm ci` setups often carry is removed for this one child.
 */
export function installElectron(repo, { stdio = ['ignore', process.stderr, process.stderr], env = process.env } = {}) {
  const childEnv = { ...env };
  delete childEnv.ELECTRON_SKIP_BINARY_DOWNLOAD;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [electronInstaller(repo)], { cwd: repo, env: childEnv, stdio });
    child.once('error', reject);
    child.once('close', code => code === 0 ? resolve() : reject(new Error(`Electron install exited with status ${code}`)));
  });
}
