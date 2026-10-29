export type UpdateChannel = 'preview' | 'stable';
export type UpdateArchitecture = 'arm64' | 'x64';

export interface DeveloperIdSigningPolicy {
  readonly schemaVersion: 1;
  readonly mode: 'developer-id';
  readonly teamId: '2CUPSQS986';
  readonly identifier: 'org.jones-systems.hq.local';
  readonly hardenedRuntime: true;
  readonly secureTimestamp: true;
  readonly notarized: true;
  readonly stapled: true;
}

export interface BuildReceipt {
  readonly signingPolicy?: DeveloperIdSigningPolicy;
  readonly schemaVersion: 1;
  readonly product: 'hq';
  readonly version: string;
  readonly buildSequence: number;
  readonly sourceSha: string;
  readonly sourceTree: string;
  readonly channel: UpdateChannel;
  readonly compatibilityEpoch: string;
  readonly electronVersion: string;
  readonly appName: string;
  readonly bundleId: 'org.jones-systems.hq.local' | 'org.jones-systems.hq.updater-test';
  readonly architecture: UpdateArchitecture;
}

export interface UpdateManifest extends BuildReceipt {
  readonly bundleId: 'org.jones-systems.hq.local';
  readonly repository: { readonly name: 'Jones-Systems/HQ'; readonly id: number; readonly ownerId: number };
  readonly platform: 'darwin';
  readonly releaseTag: string;
  readonly sourceRef?: 'refs/heads/main';
  readonly workflow: '.github/workflows/hq-desktop-package.yml';
  readonly runId: string;
  readonly runAttempt: number;
  readonly event: 'push';
  readonly publishedAt: string;
  readonly signing: 'adhoc' | 'developer-id';
  readonly archive: {
    readonly name: string;
    readonly size: number;
    readonly sha256: string;
    readonly expandedSize: number;
    readonly fileCount: number;
  };
  readonly attestation: string;
}

export interface SyntheticUpdateManifest extends Omit<UpdateManifest, 'bundleId' | 'appName'> {
  readonly bundleId: 'org.jones-systems.hq.updater-test';
  readonly appName: 'HQ Updater Test';
}

export interface InstallationRecord {
  readonly schemaVersion: 1;
  readonly product: 'hq';
  readonly installationId: string;
  readonly targetPath: string;
  readonly stateRoot: string;
  readonly userData: string;
  readonly sessionData: string;
  readonly appName: string;
  readonly bundleId: 'org.jones-systems.hq.local' | 'org.jones-systems.hq.updater-test';
  readonly channel: UpdateChannel;
  readonly compatibilityEpoch: string | 'unknown';
  readonly profileCreation: 'allowed-until-first-health' | 'forbidden';
  readonly synthetic: boolean;
  readonly installed: BuildReceipt | LegacyIdentity;
}

export interface LegacyIdentity {
  readonly kind: 'legacy';
  readonly bootstrapSha256: string;
  readonly packageSha256: string;
  readonly mainSha256: string;
}

export interface PreparedCandidate {
  readonly schemaVersion: 1;
  readonly candidateId: string;
  readonly manifest: UpdateManifest | SyntheticUpdateManifest;
  readonly bundlePath: string;
}

export interface UpdatePreferences {
  readonly automaticChecks: boolean;
  readonly backgroundDownload: boolean;
}

export type UpdatePhase = 'unavailable' | 'idle' | 'checking' | 'available' | 'downloading' | 'verifying' | 'ready' | 'scheduled' | 'held' | 'error';
export type UpdateErrorCode = 'unavailable' | 'invalid' | 'busy' | 'stale-candidate' | 'network' | 'rate-limited' | 'provenance' | 'integrity' | 'incompatible' | 'space' | 'cancelled' | 'permission' | 'recovery-required';
export interface UpdateCandidate {
  readonly candidateId: string;
  readonly version: string;
  readonly sourceSha: string;
  readonly size: number;
  readonly publishedAt: string;
}

export interface UpdateStatus {
  readonly schemaVersion: 1;
  readonly phase: UpdatePhase;
  readonly supported: boolean;
  readonly installed: { readonly version: string; readonly sourceSha: string | null; readonly channel: UpdateChannel };
  readonly preferences: UpdatePreferences;
  readonly lastCheckedAt: string | null;
  readonly nextCheckAt: string | null;
  readonly candidate: UpdateCandidate | null;
  readonly progress: { readonly received: number; readonly total: number } | null;
  readonly error: { readonly code: UpdateErrorCode; readonly message: string } | null;
  readonly recovery: { readonly state: string; readonly message: string } | null;
}

export type UpdateResult = { readonly ok: true; readonly status: UpdateStatus } | { readonly ok: false; readonly code: UpdateErrorCode; readonly status: UpdateStatus };

export interface UpdatesPort {
  status(): Promise<UpdateStatus>;
  subscribe(listener: (status: UpdateStatus) => void): () => void;
  check(): Promise<UpdateResult>;
  download(candidateId: string): Promise<UpdateResult>;
  cancelDownload(): Promise<UpdateResult>;
  setPreferences(preferences: UpdatePreferences): Promise<UpdateResult>;
  schedule(candidateId: string): Promise<UpdateResult>;
  cancelScheduled(): Promise<UpdateResult>;
  shellReady(): Promise<void>;
}
