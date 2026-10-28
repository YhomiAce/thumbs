/**
 * Lists the tag ids in IFD0 of a raw EXIF block (as returned by sharp's
 * `metadata().exif`). Enough to check for the GPS IFD pointer (0x8825).
 *
 * @param exif - Raw EXIF buffer, optionally prefixed with "Exif\0\0"
 * @returns Tag ids found in IFD0
 */
export function ifd0Tags(exif: Buffer): number[] {
  const start = exif.subarray(0, 6).toString('latin1') === 'Exif\0\0' ? 6 : 0;
  const tiff = exif.subarray(start);
  const little = tiff.subarray(0, 2).toString('latin1') === 'II';
  const u16 = (offset: number) => (little ? tiff.readUInt16LE(offset) : tiff.readUInt16BE(offset));
  const u32 = (offset: number) => (little ? tiff.readUInt32LE(offset) : tiff.readUInt32BE(offset));
  const ifd = u32(4);
  const count = u16(ifd);
  return Array.from({ length: count }, (_, i) => u16(ifd + 2 + i * 12));
}

/** EXIF tag id of the GPS IFD pointer. */
export const GPS_IFD_TAG = 0x8825;
/** EXIF tag id of Orientation. */
export const ORIENTATION_TAG = 0x0112;
