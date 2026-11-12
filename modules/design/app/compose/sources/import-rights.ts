import { RIGHTS_BASES, type Rights, type RightsBasis } from '../../../imports/src/contract.ts';
import { isBoundedText } from '../../../imports/src/media.ts';

export interface RightsDraft {
  readonly basis: RightsBasis | '';
  readonly holder: string;
  readonly license: string;
  readonly attribution: string;
}

/** No implicit rights claim: the picker needs an explicit, complete statement. */
export function selectedImportRights(draft: RightsDraft): Rights | null {
  if (draft.basis === '' || !RIGHTS_BASES.includes(draft.basis) || !isBoundedText(draft.holder)
    || (draft.basis === 'licensed' && !isBoundedText(draft.license))
    || (draft.license !== '' && !isBoundedText(draft.license))
    || (draft.attribution !== '' && !isBoundedText(draft.attribution))) return null;
  return { basis: draft.basis, holder: draft.holder,
    ...(draft.license === '' ? {} : { license: draft.license }),
    ...(draft.attribution === '' ? {} : { attribution: draft.attribution }) };
}
