/** Image formats accepted for upload. */
export type ImageType = 'jpeg' | 'png' | 'webp' | 'avif';

/** MIME type for each accepted format. */
export const MIME_TYPES: Record<ImageType, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  avif: 'image/avif',
};

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const AVIF_BRANDS = new Set(['avif', 'avis']);

function startsWith(buf: Uint8Array, bytes: number[], offset = 0): boolean {
  if (buf.length < offset + bytes.length) return false;
  return bytes.every((byte, i) => buf[offset + i] === byte);
}

function ascii(buf: Uint8Array, start: number, end: number): string {
  return Buffer.from(buf.subarray(start, end)).toString('latin1');
}

/**
 * Detects the image format from its leading bytes ("magic bytes"), ignoring the
 * file name and the client-supplied Content-Type.
 *
 * - JPEG: `FF D8 FF`
 * - PNG: the 8-byte PNG signature
 * - WebP: `RIFF....WEBP`
 * - AVIF: an ISO-BMFF `ftyp` box whose major or compatible brand is `avif`/`avis`
 *
 * @param buf - The file contents (only the first few dozen bytes are read)
 * @returns The detected format, or `null` if it isn't one we accept
 */
export function detectImageType(buf: Uint8Array): ImageType | null {
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return 'jpeg';
  if (startsWith(buf, PNG_SIGNATURE)) return 'png';
  if (buf.length >= 12 && ascii(buf, 0, 4) === 'RIFF' && ascii(buf, 8, 12) === 'WEBP') return 'webp';
  if (buf.length >= 16 && ascii(buf, 4, 8) === 'ftyp') {
    const boxSize = Buffer.from(buf.subarray(0, 4)).readUInt32BE(0);
    const end = Math.min(boxSize >= 16 ? boxSize : 16, buf.length);
    // major brand at 8..12, then minor version (4 bytes), then compatible brands
    const brands = [ascii(buf, 8, 12)];
    for (let i = 16; i + 4 <= end; i += 4) brands.push(ascii(buf, i, i + 4));
    if (brands.some((brand) => AVIF_BRANDS.has(brand))) return 'avif';
  }
  return null;
}
