import type { WorkspaceRecords } from '../storage/index.ts';
import type { ThumbnailPort } from '../../projects/src/contract.ts';
import { parsePreviewRef } from '../../projects/src/content.ts';
import { DEFAULT_LIMITS } from '../../projects/src/controller.ts';
import { THUMBNAIL_MEDIA_TYPES } from '../../projects/src/loader.ts';

export function createWorkspaceThumbnailPort(workspace: Partial<Pick<WorkspaceRecords, 'getBlob'>>): ThumbnailPort {
  const getBlob = workspace.getBlob?.bind(workspace);
  return {
    async readThumbnail(ref, signal) {
      signal.throwIfAborted();
      const selected = parsePreviewRef(ref);
      if (!selected || !THUMBNAIL_MEDIA_TYPES.includes(selected.mediaType)
        || selected.bytes > DEFAULT_LIMITS.maxThumbnailBytes) throw new Error('Invalid or unsupported thumbnail reference');
      if (!getBlob) throw new Error('Thumbnail storage is unavailable');
      const bytes = await getBlob(selected.digest);
      // The blob port cannot abort an in-flight read; its late result must not be published.
      signal.throwIfAborted();
      if (bytes === null) throw new Error('Thumbnail image is not stored on this device');
      if (!(bytes instanceof Uint8Array) || bytes.byteLength !== selected.bytes) throw new Error('Invalid thumbnail payload');
      // Blob storage carries no media metadata. The immutable reference supplies the type;
      // the Projects loader verifies these copied bytes against its digest before display.
      return { mediaType: selected.mediaType, bytes: new Uint8Array(bytes) };
    },
  };
}
