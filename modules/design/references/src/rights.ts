import type { ClaimLevel, RightsStatus, ValidationIssue } from './contract.ts';
import type { DeclaredRightsInput, GraphRights } from './graph-contract.ts';
import { isText } from './provenance.ts';

/**
 * Explicit, conservative mapping from source rights vocabularies to the one
 * effective status HQ acts on. Producers keep their own words (`declared`);
 * only a registered pair can ever map to `permitted`, and every other pair —
 * unregistered vocabulary, unregistered value, or a typo — maps to `unknown`.
 * Anything that is not an unambiguous grant (study-only, attribution-required,
 * internal, private) is never `permitted`.
 *
 * The producer vocabularies are section-declared value sets; adding or
 * changing a value means a new vocabulary version, never an edit in place.
 */
export interface RightsMapping {
  readonly effective: RightsStatus;
  readonly private: boolean;
}

const PERMITTED: RightsMapping = { effective: 'permitted', private: false };
const RESTRICTED: RightsMapping = { effective: 'restricted', private: false };
const PRIVATE: RightsMapping = { effective: 'restricted', private: true };
const UNKNOWN: RightsMapping = { effective: 'unknown', private: false };

export const HQ_RIGHTS_VOCABULARY = 'hq.design.references/v1';
export const STUDY_RIGHTS_VOCABULARY = 'producer.study-corpus/v1';
export const REA_RIGHTS_VOCABULARY = 'producer.rea/v1';

export const RIGHTS_VOCABULARIES: Readonly<Record<string, Readonly<Record<string, RightsMapping>>>> = Object.freeze({
  [HQ_RIGHTS_VOCABULARY]: Object.freeze({ permitted: PERMITTED, restricted: RESTRICTED, unknown: UNKNOWN }),
  [STUDY_RIGHTS_VOCABULARY]: Object.freeze({
    'public-domain': PERMITTED, licensed: PERMITTED,
    'study-only': RESTRICTED, internal: RESTRICTED, private: PRIVATE,
    unreviewed: UNKNOWN,
  }),
  [REA_RIGHTS_VOCABULARY]: Object.freeze({
    cleared: PERMITTED,
    // A grant that depends on conditions is not an unambiguous grant.
    'attribution-required': UNKNOWN, 'non-commercial': RESTRICTED, private: PRIVATE, unknown: UNKNOWN,
  }),
});

export function isRegisteredRights(vocabulary: string, value: string): boolean {
  return Object.hasOwn(RIGHTS_VOCABULARIES, vocabulary) && Object.hasOwn(RIGHTS_VOCABULARIES[vocabulary]!, value);
}

export function mapDeclaredRights(vocabulary: string, value: string): RightsMapping {
  return isRegisteredRights(vocabulary, value) ? RIGHTS_VOCABULARIES[vocabulary]![value]! : UNKNOWN;
}

const TOKEN = /^[a-z0-9][a-z0-9._/-]{0,63}$/u;
export const isRightsToken = (value: unknown): value is string => typeof value === 'string' && TOKEN.test(value);

export function unknownRights(setBy: ClaimLevel, setAt: string): GraphRights {
  return {
    declared: { vocabulary: HQ_RIGHTS_VOCABULARY, value: 'unknown' }, effective: 'unknown', private: false,
    basis: null, attribution: null, setBy, setAt,
  };
}

/** Maps a declared pair to rights. `permitted` needs a stated basis; otherwise the input is rejected. */
export function buildRights(
  raw: DeclaredRightsInput, setBy: ClaimLevel, setAt: string, issues: ValidationIssue[], field = 'rights',
): GraphRights {
  const before = issues.length;
  if (raw === null || typeof raw !== 'object') { issues.push({ field, code: 'invalid' }); return unknownRights(setBy, setAt); }
  if (!isRightsToken(raw.vocabulary)) issues.push({ field: `${field}.vocabulary`, code: 'invalid' });
  if (!isRightsToken(raw.value)) issues.push({ field: `${field}.value`, code: 'invalid' });
  if (raw.basis !== undefined && !isText(raw.basis, 500)) issues.push({ field: `${field}.basis`, code: 'invalid' });
  if (raw.attribution !== undefined && !isText(raw.attribution, 500)) issues.push({ field: `${field}.attribution`, code: 'invalid' });
  if (issues.length > before) return unknownRights(setBy, setAt);
  const mapped = mapDeclaredRights(raw.vocabulary, raw.value);
  if (mapped.effective === 'permitted' && raw.basis === undefined) {
    issues.push({ field: `${field}.basis`, code: 'required-when-permitted' });
    return unknownRights(setBy, setAt);
  }
  return {
    declared: { vocabulary: raw.vocabulary, value: raw.value }, effective: mapped.effective, private: mapped.private,
    basis: raw.basis ?? null, attribution: raw.attribution ?? null, setBy, setAt,
  };
}

/** Only an explicit, non-private grant with a stated basis may enter publishable output. */
export function isGraphPublishable(rights: GraphRights): boolean {
  return rights.effective === 'permitted' && !rights.private && rights.basis !== null;
}

export type PublishBlock = 'rights-restricted' | 'rights-unknown' | 'private';

/** Why a capture's rights keep it out of publishable output, or null if they do not. */
export function publishBlock(rights: GraphRights): PublishBlock | null {
  if (isGraphPublishable(rights)) return null;
  if (rights.private) return 'private';
  return rights.effective === 'restricted' ? 'rights-restricted' : 'rights-unknown';
}

/** Re-derives the mapping of a persisted record; a stored value that disagrees is invalid. */
export function rightsAgreeWithRegistry(rights: GraphRights): boolean {
  const mapped = mapDeclaredRights(rights.declared.vocabulary, rights.declared.value);
  return rights.effective === mapped.effective && rights.private === mapped.private
    && (rights.effective !== 'permitted' || rights.basis !== null);
}
