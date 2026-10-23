import { createHash } from 'node:crypto';
import type { BuildReceipt, InstallationRecord, UpdateArchitecture, UpdateChannel, UpdateManifest } from '@hq/contracts/updates';
import { API_ROOT, REPOSITORY, REPOSITORY_URL, WORKFLOW, UpdateFailure, contract, object } from './contract.js';
import { readBytes, type Transport } from './transport.js';
import type { ProvenanceVerifier } from './provenance.js';

export interface DiscoveredCandidate {
  readonly candidateId: string;
  readonly manifest: UpdateManifest;
  readonly manifestHash: string;
  readonly archiveURL: string;
  readonly bundle: unknown;
}
interface Asset { name: string; size: number; digest: string; browser_download_url: string }
export interface DiscoveryOptions {
  readonly installed: BuildReceipt | null;
  readonly record: InstallationRecord | null;
  readonly fresh?: true;
  readonly channel?: UpdateChannel;
  readonly architecture: UpdateArchitecture;
  readonly transport: Transport;
  readonly verify: ProvenanceVerifier;
  readonly cachePath: string;
  readonly signal: AbortSignal;
}

export const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

function asset(value: unknown, name: string, tag: string, limit: number): Asset {
  if (!object(value) || value.name !== name || !Number.isSafeInteger(value.size) || Number(value.size) <= 0 || Number(value.size) > limit || typeof value.digest !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(value.digest) || value.browser_download_url !== `${REPOSITORY_URL}/releases/download/${encodeURIComponent(tag)}/${name}`) throw new UpdateFailure('provenance');
  return value as unknown as Asset;
}

async function assetBytes(options: DiscoveryOptions, item: Asset, limit: number): Promise<Buffer> {
  const bytes = await readBytes(options.transport, new URL(item.browser_download_url), limit, options.signal, item.size);
  if (`sha256:${sha256(bytes)}` !== item.digest) throw new UpdateFailure('integrity');
  return bytes;
}

function uniqueAsset(assets: unknown[], name: string, tag: string, limit: number): Asset {
  const matches = assets.filter(value => object(value) && value.name === name);
  if (matches.length !== 1) throw new UpdateFailure('provenance');
  return asset(matches[0], name, tag, limit);
}

export function checkCompatibility(manifest: UpdateManifest, installed: BuildReceipt, record: InstallationRecord, architecture: UpdateArchitecture): void {
  checkReleaseIdentity(manifest, architecture, record.channel);
  if (installed.signingPolicy && !manifest.signingPolicy) throw new UpdateFailure('incompatible');
  if (manifest.compatibilityEpoch !== record.compatibilityEpoch || manifest.compatibilityEpoch !== installed.compatibilityEpoch || manifest.appName !== installed.appName || manifest.bundleId !== installed.bundleId || manifest.architecture !== installed.architecture) throw new UpdateFailure('incompatible');
}

function checkReleaseIdentity(manifest: UpdateManifest, architecture: UpdateArchitecture, channel: UpdateChannel): void {
  if (manifest.repository.name !== REPOSITORY.name || manifest.repository.id !== REPOSITORY.id || manifest.repository.ownerId !== REPOSITORY.ownerId || manifest.platform !== 'darwin' || manifest.workflow !== WORKFLOW || manifest.event !== 'push' || manifest.signing !== (manifest.signingPolicy ? 'developer-id' : 'adhoc') || manifest.bundleId !== 'org.jones-systems.hq.local' || manifest.appName !== 'HQ' || !/^hq-desktop-[A-Za-z0-9._-]+$/.test(manifest.releaseTag)) throw new UpdateFailure('provenance');
  if (manifest.architecture !== architecture || manifest.channel !== channel) throw new UpdateFailure('incompatible');
}

export function verifyWorkflowRun(value: unknown, manifest: UpdateManifest): void {
  if (!object(value) || !object(value.repository) || !object(value.repository.owner) || !object(value.head_repository) || value.repository.id !== REPOSITORY.id || value.repository.full_name !== REPOSITORY.name || value.repository.owner.id !== REPOSITORY.ownerId || value.head_repository.id !== REPOSITORY.id || String(value.id) !== manifest.runId || value.run_attempt !== manifest.runAttempt || value.head_sha !== manifest.sourceSha || value.path !== WORKFLOW || value.event !== 'push' || value.status !== 'completed' || value.conclusion !== 'success') throw new UpdateFailure('provenance');
}

export async function discover(options: DiscoveryOptions): Promise<DiscoveredCandidate | null> {
  const channel = options.record?.channel ?? options.channel;
  if (!channel || !['preview', 'stable'].includes(channel) || (!options.record || !options.installed) && !(options.fresh === true && options.record === null && options.installed === null)) throw new UpdateFailure('invalid');
  const json = async (path: string, limit = 2 * 1024 * 1024): Promise<unknown> => {
    try { return JSON.parse((await readBytes(options.transport, new URL(`${API_ROOT}${path}`), limit, options.signal)).toString('utf8')); }
    catch (error) { if (error instanceof UpdateFailure) throw error; throw new UpdateFailure('provenance'); }
  };
  const repository = await json('', 128 * 1024);
  if (!object(repository) || repository.id !== REPOSITORY.id || repository.full_name !== REPOSITORY.name || !object(repository.owner) || repository.owner.id !== REPOSITORY.ownerId || repository.private !== false) throw new UpdateFailure('provenance');
  const releases = await json('/releases?per_page=20');
  if (!Array.isArray(releases) || releases.length > 20) throw new UpdateFailure('provenance');
  const manifestName = `hq-darwin-${options.architecture}.json`;
  const choices: { release: Record<string, unknown>; manifest: UpdateManifest; hash: string; archive: Asset; attestation: Asset }[] = [];
  for (const release of releases) {
    if (!object(release) || release.draft !== false || release.prerelease !== (channel === 'preview')) continue;
    if (typeof release.tag_name !== 'string' || !/^hq-desktop-[A-Za-z0-9._-]+$/.test(release.tag_name) || !Array.isArray(release.assets) || release.assets.length > 32) continue;
    if (!release.assets.some(value => object(value) && value.name === manifestName)) continue;
    const source = uniqueAsset(release.assets, manifestName, release.tag_name, 64 * 1024);
    const bytes = await assetBytes(options, source, 64 * 1024);
    let manifest: UpdateManifest;
    try { manifest = contract.validateManifest(JSON.parse(bytes.toString('utf8'))); }
    catch { throw new UpdateFailure('provenance'); }
    checkReleaseIdentity(manifest, options.architecture, channel);
    if (manifest.releaseTag !== release.tag_name || manifest.archive.name !== `hq-darwin-${options.architecture}.zip` || manifest.attestation !== `hq-darwin-${options.architecture}.sigstore.json`) throw new UpdateFailure('provenance');
    if (options.installed && manifest.buildSequence <= options.installed.buildSequence) continue;
    const archive = uniqueAsset(release.assets, manifest.archive.name, release.tag_name, contract.MAX_ARCHIVE_BYTES);
    if (archive.size !== manifest.archive.size || archive.digest !== `sha256:${manifest.archive.sha256}`) throw new UpdateFailure('integrity');
    const attestation = uniqueAsset(release.assets, manifest.attestation, release.tag_name, 2 * 1024 * 1024);
    choices.push({ release, manifest, hash: sha256(bytes), archive, attestation });
  }
  choices.sort((a, b) => b.manifest.buildSequence - a.manifest.buildSequence);
  const choice = choices[0];
  if (!choice) return null;
  if (options.installed && options.record) checkCompatibility(choice.manifest, options.installed, options.record, options.architecture);
  if (choices[1]?.manifest.buildSequence === choice.manifest.buildSequence && contract.candidateId(choices[1].manifest) !== contract.candidateId(choice.manifest)) throw new UpdateFailure('provenance');
  verifyWorkflowRun(await json(`/actions/runs/${choice.manifest.runId}/attempts/${choice.manifest.runAttempt}`), choice.manifest);
  let bundle: unknown;
  try { bundle = JSON.parse((await assetBytes(options, choice.attestation, 2 * 1024 * 1024)).toString('utf8')); }
  catch (error) { if (error instanceof UpdateFailure) throw error; throw new UpdateFailure('provenance'); }
  await options.verify({ bundle, manifest: choice.manifest, archiveHash: choice.manifest.archive.sha256, manifestHash: choice.hash, cachePath: options.cachePath, signal: options.signal });
  return { candidateId: contract.candidateId(choice.manifest), manifest: choice.manifest, manifestHash: choice.hash, archiveURL: choice.archive.browser_download_url, bundle };
}
