import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { planVariants, type VariantSize } from './variants.js';

/** Result of processing one original. */
export interface TransformResult {
  width: number;
  height: number;
  dominantColor: string;
  variants: Array<{
    size: VariantSize;
    width: number;
    height: number;
    bytes: number;
    etag: string;
    data: Buffer;
  }>;
}

const WEBP_QUALITY = 80;

function toHex(value: number): string {
  return Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0');
}

/**
 * Creates the WebP thumbnails for an original image.
 *
 * The image is auto-oriented from its EXIF Orientation tag first, then resized.
 * sharp drops all metadata (EXIF, GPS, XMP, ICC beyond sRGB conversion) on output
 * unless asked to keep it, so the variants carry no location or camera data.
 *
 * @param original - Original image bytes (JPEG, PNG, WebP or AVIF)
 * @returns Oriented dimensions, the dominant colour and the encoded variants
 * @throws {Error} If sharp can't decode the image
 */
export async function transformImage(original: Buffer): Promise<TransformResult> {
  const source = sharp(original, { failOn: 'error' });
  const metadata = await source.metadata();
  const width = metadata.autoOrient.width;
  const height = metadata.autoOrient.height;
  const plans = planVariants(width, height);

  const variants: TransformResult['variants'] = [];
  for (const plan of plans) {
    const { data, info } = await sharp(original, { failOn: 'error' })
      .autoOrient()
      .resize({ width: plan.width, withoutEnlargement: true })
      .webp({ quality: WEBP_QUALITY })
      .toBuffer({ resolveWithObject: true });
    variants.push({
      size: plan.size,
      width: info.width,
      height: info.height,
      bytes: data.length,
      etag: `"${createHash('sha256').update(data).digest('base64url').slice(0, 27)}"`,
      data,
    });
  }
  // Measured on the smallest variant: same colours, without decoding the full original again.
  const smallest = variants[0];
  if (!smallest) throw new Error('No variants were produced');
  const { r, g, b } = (await sharp(smallest.data).stats()).dominant;
  const dominantColor = `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  return { width, height, dominantColor, variants };
}
