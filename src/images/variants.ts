/** Thumbnail widths generated for every image, in pixels. */
export const VARIANT_SIZES = [160, 480, 1280] as const;

/** One of the generated thumbnail widths. */
export type VariantSize = (typeof VARIANT_SIZES)[number];

/** Target dimensions of one variant. */
export interface VariantPlan {
  size: VariantSize;
  width: number;
  height: number;
}

/**
 * Checks whether a value is one of the generated sizes.
 *
 * @param value - Candidate size
 * @returns True for 160, 480 or 1280
 */
export function isVariantSize(value: number): value is VariantSize {
  return (VARIANT_SIZES as readonly number[]).includes(value);
}

/**
 * Computes the output dimensions of each variant for an (already oriented)
 * image. Images are never enlarged: if the original is narrower than a size,
 * that variant keeps the original width.
 *
 * @param width - Original width after orientation correction
 * @param height - Original height after orientation correction
 * @returns One plan per size, in ascending order
 * @throws {RangeError} If the dimensions aren't positive integers
 */
export function planVariants(width: number, height: number): VariantPlan[] {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new RangeError(`Invalid image dimensions ${width}x${height}`);
  }
  return VARIANT_SIZES.map((size) => {
    const targetWidth = Math.min(size, width);
    const targetHeight = Math.max(1, Math.round((height * targetWidth) / width));
    return { size, width: targetWidth, height: targetHeight };
  });
}

/**
 * Percentage saved by a variant compared to the original, rounded to one decimal.
 * Negative when the variant is larger (possible for tiny, already-compressed originals).
 *
 * @param originalBytes - Original file size
 * @param variantBytes - Variant file size
 * @returns e.g. `93.4` for "93.4% smaller"
 */
export function savingsPercent(originalBytes: number, variantBytes: number): number {
  if (originalBytes <= 0) return 0;
  return Math.round((1 - variantBytes / originalBytes) * 1000) / 10;
}

/**
 * Formats a byte count for humans (B, KB, MB with one decimal).
 *
 * @param bytes - Size in bytes
 * @returns e.g. `"12.3 KB"`
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
