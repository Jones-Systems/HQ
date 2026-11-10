/**
 * Main-process entry for HQ Design taste. Root wires TasteService to a typed
 * channel and validates inbound commands with parseTasteCommand.
 */
export { TasteJournal, verifyJournalBytes, type OpenJournalOptions, type OpenJournalResult } from './journal.ts';
export { TasteService, parseExportOptions, parseTasteCommand, type TasteServiceOptions } from './service.ts';
export { createNodeTasteFileSystem, nodeSha256 } from './node-file-system.ts';
export { canonicalize } from './jcs.ts';
export {
  createProjectTasteContribution, TasteProjectBindingError, TasteUnavailableError, TASTE_DOCUMENT_KEY,
  type ProjectTasteContribution, type ProjectTasteOptions, type TasteDocumentPort, type TasteJournalDocument,
} from './project-service.ts';
