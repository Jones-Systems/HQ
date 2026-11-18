export interface ProtectedStorage {
  isEncryptionAvailable(): boolean;
  getSelectedStorageBackend?(): string;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}
export function credentialCodec(storage: ProtectedStorage, platform: NodeJS.Platform = process.platform) {
  function requireProtection() {
    if (!storage.isEncryptionAvailable()) throw Error('Protected storage unavailable');
    if (platform === 'linux') {
      const backend = storage.getSelectedStorageBackend?.();
      if (!backend || backend === 'basic_text' || backend === 'unknown') throw Error('Protected storage unavailable');
    }
  }
  return {
    encode(value: string) { requireProtection(); return storage.encryptString(value); },
    decode(value: Buffer) { requireProtection(); return storage.decryptString(value); },
  };
}
