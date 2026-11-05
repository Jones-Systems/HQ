import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { ServiceResponse } from '@hq/contracts/services';
import type { ServiceConfig } from './service-config.js';
import { keys, record } from './services.js';
import type { SaveBytes } from './save-dialog.js';

export const WORK_EXPORT_CAP = 8 * 1024 * 1024;
export type ExportRead = (url: URL) => Promise<ServiceResponse<Uint8Array>>;
export const readExport: ExportRead = url => new Promise(resolve => {
  let settled = false;
  const finish = (result: ServiceResponse<Uint8Array>) => {
    if (!settled) { settled = true; clearTimeout(timer); resolve(result); }
  };
  let req: ReturnType<typeof httpRequest> | undefined;
  const fail = () => { finish({ ok: false, kind: 'unavailable' }); req?.destroy(); };
  const timer = setTimeout(fail, 10_000);
  try {
    req = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, { method: 'GET', headers: { Accept: '*/*' } }, res => {
      const chunks: Buffer[] = [];
      let length = 0;
      res.on('data', (chunk: Buffer) => {
        length += chunk.length;
        if (length > WORK_EXPORT_CAP) { fail(); res.destroy(); }
        else chunks.push(chunk);
      });
      res.on('error', fail);
      res.on('aborted', fail);
      res.on('end', () => {
        if (!res.complete) { fail(); return; }
        finish({ ok: true, status: res.statusCode!, body: Buffer.concat(chunks), replayed: res.headers['x-replayed'] === '1' });
      });
    });
    req.on('error', fail);
    req.end();
  } catch { fail(); }
});

export function createWorkExport(config: Pick<ServiceConfig, 'get'>, save: SaveBytes, read: ExportRead = readExport) {
  return async (params: unknown): Promise<ServiceResponse<{ saved: boolean }>> => {
    let saving = false;
    try {
      if (!record(params) || !keys(params, ['format']) || (params.format !== 'json' && params.format !== 'markdown')) return { ok: false, kind: 'unavailable' };
      const base = config.get('work');
      if (!base) return { ok: false, kind: 'unavailable' };
      const response = await read(new URL(params.format === 'json' ? '/api/export' : '/api/export.md', base));
      if (!response.ok) return response;
      if (!(response.body instanceof Uint8Array) || response.body.byteLength > WORK_EXPORT_CAP) return { ok: false, kind: 'unavailable' };
      if (response.status < 200 || response.status >= 300) return { ...response, body: { saved: false } };
      const extension = params.format === 'json' ? 'json' : 'md';
      saving = true;
      const body = await save(response.body, { defaultPath: `planning-export.${extension}`, filters: [{ name: params.format, extensions: [extension] }] });
      return { ...response, body };
    } catch { return { ok: false, kind: saving ? 'unknown' : 'unavailable' }; }
  };
}
