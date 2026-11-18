/** Module-local structural equivalent of ServiceResponse<{ saved: boolean }>. */
export type WorkExportResponse =
  | { readonly ok: true; readonly status: number; readonly body: { saved: boolean }; readonly replayed: boolean }
  | { readonly ok: false; readonly kind: 'unavailable' | 'unknown' };

/** Structural seam for the shell-owned client; bytes and destinations stay in main. */
export interface WorkExportPort {
  export(format: 'json' | 'markdown'): Promise<WorkExportResponse>;
}
