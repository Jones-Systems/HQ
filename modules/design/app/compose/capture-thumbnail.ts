/**
 * Thumbnail for a saved live capture (B3 backend contract; see BACKEND-CONTRACT.md).
 *
 * The desktop preview host stores each coherent capture's PNG in the Design blob store under the capture
 * digest, but its `CaptureRecord` carries no byte size. The size, the format and the pixel size are therefore
 * read from the stored bytes. A `PreviewRef` is returned only for bytes that hash to that digest, are a PNG,
 * and fit the Projects thumbnail limits. Otherwise there is no thumbnail: one is never described or faked.
 * Resolution later goes through `thumbnail-port.ts`, which reads the same blob by the same digest.
 */
import type { PreviewRef } from '../../projects/src/contract.ts';
import { DEFAULT_LIMITS } from '../../projects/src/controller.ts';
import { THUMBNAIL_MEDIA_TYPES } from '../../projects/src/loader.ts';
import { sha256Hex } from './canonical.ts';

export type CaptureBlobReader = (digest: string) => Promise<Uint8Array | null>;

const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const IHDR = [0x49, 0x48, 0x44, 0x52];
const MAX_SIDE = 100_000;

/** Pixel size from the PNG header, or null when the bytes are not a PNG with a sane header. */
function pngSize(bytes: Uint8Array): { readonly w: number; readonly h: number } | null {
  if (bytes.byteLength < 24 || !PNG_SIGNATURE.every((byte, index) => bytes[index] === byte) || !IHDR.every((byte, index) => bytes[12 + index] === byte)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const w = view.getUint32(16);
  const h = view.getUint32(20);
  return w > 0 && h > 0 && w <= MAX_SIDE && h <= MAX_SIDE ? { w, h } : null;
}

/**
 * The Projects thumbnail reference for a stored capture, or `undefined` when it does not qualify:
 * no blob reader, no stored bytes, a digest that does not match the bytes, not a PNG, or larger than
 * `maxBytes` (default: the Projects thumbnail limit). Never throws.
 */
export async function captureThumbnailRef(read: CaptureBlobReader | null, digest: string, maxBytes = DEFAULT_LIMITS.maxThumbnailBytes): Promise<PreviewRef | undefined> {
  if (read === null || !DIGEST.test(digest) || !THUMBNAIL_MEDIA_TYPES.includes('image/png')) return undefined;
  try {
    const bytes = await read(digest);
    if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0 || bytes.byteLength > maxBytes) return undefined;
    const size = pngSize(bytes);
    if (size === null || `sha256:${await sha256Hex(bytes)}` !== digest) return undefined;
    return { digest, mediaType: 'image/png', bytes: bytes.byteLength, w: size.w, h: size.h };
  } catch { return undefined; }
}
