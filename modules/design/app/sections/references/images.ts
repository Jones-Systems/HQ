import type { AssetRef, BlobDigest } from '../../../references/src/contract.ts';
import { sha256Hex } from '../../../references/src/jcs.ts';

export const MAX_IMAGE_BYTES = 16 * 1024 * 1024;
const MAX_PIXELS = 32 * 1024 * 1024;
const MAX_EDGE = 16_384;
export type ImageType = 'image/png' | 'image/jpeg' | 'image/webp';
export interface SelectedImageFile {
  readonly name: string;
  readonly size: number;
  readonly type: string;
  readonly lastModified: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}
export interface ImageDimensions { readonly w: number; readonly h: number }
export type ImageDecoder = (bytes: Uint8Array, mediaType: ImageType) => Promise<ImageDimensions>;
export interface SelectedImage extends ImageDimensions {
  readonly bytes: Uint8Array;
  readonly mediaType: ImageType;
  readonly capturedAt: string;
}

const validDimensions = ({ w, h }: ImageDimensions) => Number.isInteger(w) && Number.isInteger(h)
  && w > 0 && h > 0 && w <= MAX_EDGE && h <= MAX_EDGE && w * h <= MAX_PIXELS;
const ascii = (bytes: Uint8Array, offset: number, text: string) => [...text].every((character, index) => bytes[offset + index] === character.charCodeAt(0));

// Header dimensions are bounded before asking the browser to allocate a decoded image.
function imageHeader(bytes: Uint8Array): { mediaType: ImageType; dimensions: ImageDimensions } {
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length >= 33 && [137, 80, 78, 71, 13, 10, 26, 10].every((byte, i) => bytes[i] === byte)
    && data.getUint32(8) === 13 && ascii(bytes, 12, 'IHDR')) {
    return { mediaType: 'image/png', dimensions: { w: data.getUint32(16), h: data.getUint32(20) } };
  }
  if (bytes.length >= 12 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) {
    let offset = 2;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset] !== 255) break;
      while (bytes[offset] === 255) offset += 1;
      const marker = bytes[offset++];
      if (marker === 217 || marker === 218 || marker === undefined) break;
      if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
      if (offset + 2 > bytes.length) break;
      const length = data.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker) && length >= 8) {
        return { mediaType: 'image/jpeg', dimensions: { h: data.getUint16(offset + 3), w: data.getUint16(offset + 5) } };
      }
      offset += length;
    }
  }
  if (bytes.length >= 26 && ascii(bytes, 0, 'RIFF') && ascii(bytes, 8, 'WEBP') && data.getUint32(4, true) + 8 === bytes.length) {
    if (bytes.length >= 30 && ascii(bytes, 12, 'VP8X')) {
      const uint24 = (offset: number) => bytes[offset]! + (bytes[offset + 1]! << 8) + (bytes[offset + 2]! << 16);
      return { mediaType: 'image/webp', dimensions: { w: 1 + uint24(24), h: 1 + uint24(27) } };
    }
    if (bytes.length >= 30 && ascii(bytes, 12, 'VP8 ') && bytes[23] === 157 && bytes[24] === 1 && bytes[25] === 42) {
      return { mediaType: 'image/webp', dimensions: { w: data.getUint16(26, true) & 16_383, h: data.getUint16(28, true) & 16_383 } };
    }
    if (ascii(bytes, 12, 'VP8L') && bytes[20] === 47) {
      return { mediaType: 'image/webp', dimensions: { w: 1 + bytes[21]! + ((bytes[22]! & 63) << 8),
        h: 1 + (bytes[22]! >> 6) + (bytes[23]! << 2) + ((bytes[24]! & 15) << 10) } };
    }
  }
  throw new Error('Choose a valid PNG, JPEG or WebP image. SVG and HTML files are not supported.');
}

export function imageDataUrl(bytes: Uint8Array, mediaType: ImageType): string {
  let binary = '';
  for (let start = 0; start < bytes.length; start += 8192) binary += String.fromCharCode(...bytes.subarray(start, start + 8192));
  return `data:${mediaType};base64,${globalThis.btoa(binary)}`;
}

export const decodeImage: ImageDecoder = async (bytes, mediaType) => {
  if (typeof globalThis.createImageBitmap === 'function') {
    const bitmap = await globalThis.createImageBitmap(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mediaType }), { imageOrientation: 'none' });
    try { return { w: bitmap.width, h: bitmap.height }; } finally { bitmap.close(); }
  }
  const image = new Image();
  try {
    image.src = imageDataUrl(bytes, mediaType);
    await image.decode();
    return { w: image.naturalWidth, h: image.naturalHeight };
  } finally { image.removeAttribute('src'); }
};

async function inspect(bytes: Uint8Array, mediaType: string, decode: ImageDecoder): Promise<{ mediaType: ImageType; dimensions: ImageDimensions }> {
  if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) throw new Error('Images must be no larger than 16 MiB.');
  const header = imageHeader(bytes);
  if (mediaType !== '' && mediaType !== header.mediaType) throw new Error('The image contents do not match its file type.');
  if (!validDimensions(header.dimensions)) throw new Error('This image is too large. Use an image up to 32 megapixels and 16,384 pixels per side.');
  let dimensions: ImageDimensions;
  try { dimensions = await decode(bytes, header.mediaType); } catch { throw new Error('This image could not be decoded. Choose another PNG, JPEG or WebP.'); }
  if (!validDimensions(dimensions) || dimensions.w !== header.dimensions.w || dimensions.h !== header.dimensions.h) {
    throw new Error('The image dimensions are invalid.');
  }
  return { ...header, dimensions };
}

export async function readSelectedImage(file: SelectedImageFile, decode: ImageDecoder = decodeImage): Promise<SelectedImage> {
  if (!Number.isSafeInteger(file.size) || file.size < 1 || file.size > MAX_IMAGE_BYTES) throw new Error('Images must be no larger than 16 MiB.');
  if (!['', 'image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('Choose a PNG, JPEG or WebP image.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length !== file.size) throw new Error('The selected file changed while reading. Choose it again.');
  const { mediaType, dimensions } = await inspect(bytes, file.type, decode);
  if (!Number.isFinite(file.lastModified) || file.lastModified <= 0 || !Number.isFinite(new Date(file.lastModified).getTime())) {
    throw new Error('This image has no valid capture date.');
  }
  return { bytes, mediaType, ...dimensions, capturedAt: new Date(file.lastModified).toISOString() };
}

export async function readImagePreview(asset: AssetRef, readBlob: (digest: BlobDigest) => Promise<Uint8Array | null>, decode: ImageDecoder = decodeImage): Promise<string | null> {
  if (!/^sha256:[0-9a-f]{64}$/u.test(asset.digest) || !Number.isSafeInteger(asset.bytes) || asset.bytes < 1 || asset.bytes > MAX_IMAGE_BYTES
    || !['image/png', 'image/jpeg', 'image/webp'].includes(asset.mediaType)) return null;
  try {
    const bytes = await readBlob(asset.digest);
    if (bytes === null || bytes.length !== asset.bytes || `sha256:${await sha256Hex(bytes)}` !== asset.digest) return null;
    const { mediaType, dimensions } = await inspect(bytes, asset.mediaType, decode);
    if (dimensions.w !== asset.w || dimensions.h !== asset.h) return null;
    return imageDataUrl(bytes, mediaType);
  } catch { return null; }
}
