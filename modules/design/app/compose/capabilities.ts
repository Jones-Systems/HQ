import type { DesignCapabilities } from '@hq/contracts/design-records';
import type { DesignServiceTransport } from '@hq/contracts/services';
import type { ImportSource, Rights } from '../../imports/src/contract.ts';
import { RIGHTS_BASES } from '../../imports/src/contract.ts';
import { isBoundedText } from '../../imports/src/media.ts';
import { bridgeResultValue, DesignBridgeError } from './bridge-documents.ts';
import { toDesignOperationError } from './errors.ts';
import { FAKE_TAG, WORKSPACE_TAG, type EvidenceTag } from './labels.ts';

export const DESIGN_HELD_FEATURES = Object.freeze([
  Object.freeze({ feature: 'generation-sources', status: 'held', reason: 'external-access-held' }),
  Object.freeze({ feature: 'component-runner', status: 'held', reason: 'native-qualification-pending' }),
  Object.freeze({ feature: 'jones-code-live-send', status: 'held', reason: 'live-effects-held' }),
] as const);
export const CAPABILITIES_CONTEXT = { section: 'storage', operation: 'design.capabilities', action: 'check which Design features are on', write: false } as const;
export interface LabelledDesignCapabilities { readonly tag: EvidenceTag; readonly capabilities: DesignCapabilities }

function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
    && Reflect.ownKeys(value).length === keys.length && keys.every(key => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return descriptor !== undefined && Object.hasOwn(descriptor, 'value');
    });
}
export async function readDesignCapabilities(transport: DesignServiceTransport): Promise<DesignCapabilities> {
  try {
    let result: unknown;
    try { result = await transport.call('design.capabilities', {}); } catch { throw new DesignBridgeError('unavailable'); }
    const value = bridgeResultValue(result, 'unavailable');
    if (!exact(value, ['imports', 'pick', 'export', 'held'])
      || ![value.imports, value.pick, value.export].every(state => state === 'enabled' || state === 'disabled')
      || !Array.isArray(value.held) || value.held.length !== DESIGN_HELD_FEATURES.length
      || !DESIGN_HELD_FEATURES.every((held, index) => {
        const item: unknown = (value.held as unknown[])[index];
        return exact(item, ['feature', 'status', 'reason']) && item.feature === held.feature && item.status === held.status && item.reason === held.reason;
      })) throw new DesignBridgeError('unavailable');
    return Object.freeze({ imports: value.imports, pick: value.pick, export: value.export, held: DESIGN_HELD_FEATURES }) as DesignCapabilities;
  } catch (error) { throw toDesignOperationError(error, CAPABILITIES_CONTEXT); }
}
export async function fakeDesignCapabilities(): Promise<LabelledDesignCapabilities> {
  return Object.freeze({ tag: FAKE_TAG, capabilities: Object.freeze({ imports: 'enabled', pick: 'enabled', export: 'disabled', held: DESIGN_HELD_FEATURES }) });
}
export function capabilitiesReader(transport: DesignServiceTransport | null): () => Promise<LabelledDesignCapabilities> {
  return async () => {
    if (transport === null) throw toDesignOperationError(new DesignBridgeError('unavailable', 'disabled'), CAPABILITIES_CONTEXT);
    return Object.freeze({ tag: WORKSPACE_TAG, capabilities: await readDesignCapabilities(transport) });
  };
}

/** Capture an explicit rights statement before invoking the existing picker port. No filesystem access. */
export function withImportRights(pick: () => Promise<ImportSource | null>, rights: Rights): () => Promise<ImportSource | null> {
  const context = { section: 'imports', operation: 'imports.pick', action: 'choose files to import', write: false } as const;
  const text = isBoundedText;
  if (!rights || !RIGHTS_BASES.includes(rights.basis) || !text(rights.holder)
    || (rights.basis === 'licensed' && rights.license === undefined)
    || (rights.license !== undefined && !text(rights.license)) || (rights.attribution !== undefined && !text(rights.attribution))) {
    throw toDesignOperationError(new DesignBridgeError('invalid'), context);
  }
  const selected: Rights = Object.freeze({ basis: rights.basis, holder: rights.holder,
    ...(rights.license === undefined ? {} : { license: rights.license }), ...(rights.attribution === undefined ? {} : { attribution: rights.attribution }) });
  return async () => {
    try {
      const source = await pick();
      return source === null ? null : { ...source, items: source.items.map(item => ({ ...item, rights: selected })) };
    } catch (error) { throw toDesignOperationError(error, context); }
  };
}
