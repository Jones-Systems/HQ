/**
 * Producer failures carry a stable code and, at most, a field path inside a source JSON document.
 * Messages never contain file-system paths, file contents or configured values.
 */
export class ProducerError extends Error {
  override readonly name = 'ProducerError';
  readonly code: string;
  readonly where: string | null;
  constructor(code: string, where: string | null = null) {
    super(where === null ? code : `${code} at ${where}`);
    this.code = code;
    this.where = where;
  }
}

export function fail(code: string, where: string | null = null): never {
  throw new ProducerError(code, where);
}
