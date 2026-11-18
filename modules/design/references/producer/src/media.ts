import { fail } from './errors.ts';

/** Extension and declared media type must agree, and the leading bytes must match the type. */
const BY_EXTENSION: Readonly<Record<string, string>> = Object.freeze({
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
});

export function mediaTypeForPath(rel: string): string {
  const dot = rel.lastIndexOf('.');
  const extension = dot < 0 ? '' : rel.slice(dot + 1).toLowerCase();
  const type = Object.hasOwn(BY_EXTENSION, extension) ? BY_EXTENSION[extension] : undefined;
  return type ?? fail('excluded-content-type');
}

const startsWith = (bytes: Uint8Array, signature: readonly number[], offset = 0): boolean =>
  bytes.length >= offset + signature.length && signature.every((byte, index) => bytes[offset + index] === byte);
const ascii = (text: string): number[] => [...text].map((char) => char.charCodeAt(0));

/** True when the bytes begin like the declared inert media type; markup in disguise fails. */
export function sniffMatches(mediaType: string, bytes: Uint8Array): boolean {
  switch (mediaType) {
    case 'image/png': return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case 'image/jpeg': return startsWith(bytes, [0xff, 0xd8, 0xff]);
    case 'image/gif': return startsWith(bytes, ascii('GIF87a')) || startsWith(bytes, ascii('GIF89a'));
    case 'image/webp': return startsWith(bytes, ascii('RIFF')) && startsWith(bytes, ascii('WEBP'), 8);
    case 'image/avif': return startsWith(bytes, ascii('ftyp'), 4) && (startsWith(bytes, ascii('avif'), 8) || startsWith(bytes, ascii('avis'), 8));
    case 'video/mp4': case 'video/quicktime': return startsWith(bytes, ascii('ftyp'), 4);
    case 'video/webm': return startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3]);
    default: return false;
  }
}
