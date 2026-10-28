import sharp from 'sharp';

/** A solid-colour image in the given format. */
export async function solidImage(
  format: 'jpeg' | 'png' | 'webp' | 'avif',
  width = 64,
  height = 48,
  background = '#3366cc',
): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background } }).toFormat(format).toBuffer();
}

/**
 * A landscape 2000x1000 JPEG (red left half, blue right half) tagged with EXIF
 * Orientation 6 ("rotate 90° clockwise to display") and GPS coordinates, like a
 * phone photo taken in portrait.
 */
export async function phonePhoto(): Promise<Buffer> {
  const left = await sharp({ create: { width: 1000, height: 1000, channels: 3, background: '#d02020' } }).png().toBuffer();
  const base = await sharp({ create: { width: 2000, height: 1000, channels: 3, background: '#2040d0' } })
    .composite([{ input: left, left: 0, top: 0 }])
    .jpeg({ quality: 90 })
    .toBuffer();
  return sharp(base)
    .withMetadata({ orientation: 6 })
    .withExif({
      IFD0: { Make: 'TestCam', Model: 'Phone 1' },
      IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '52/1 30/1 0/1', GPSLongitudeRef: 'W', GPSLongitude: '0/1 7/1 0/1' },
    })
    .jpeg({ quality: 90 })
    .toBuffer();
}

/** Bytes that start like a JPEG but can't be decoded. */
export function corruptJpeg(): Buffer {
  return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(512, 0x42)]);
}
