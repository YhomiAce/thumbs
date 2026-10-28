import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { transformImage } from '../src/images/transform.js';
import { GPS_IFD_TAG, ifd0Tags, ORIENTATION_TAG } from './support/exif.js';
import { phonePhoto, solidImage } from './support/images.js';

describe('transformImage', () => {
  it('orients, resizes, strips EXIF/GPS and finds the dominant colour', async () => {
    const original = await phonePhoto();
    const input = await sharp(original).metadata();
    expect(input.orientation).toBe(6);
    expect(ifd0Tags(input.exif!)).toEqual(expect.arrayContaining([GPS_IFD_TAG, ORIENTATION_TAG]));

    const result = await transformImage(original);

    // 2000x1000 stored sideways with Orientation 6 displays as 1000x2000 portrait.
    expect(result.width).toBe(1000);
    expect(result.height).toBe(2000);
    expect(result.variants.map((v) => [v.size, v.width, v.height])).toEqual([
      [160, 160, 320],
      [480, 480, 960],
      [1280, 1000, 2000],
    ]);
    // Half red, half blue: either may win the histogram, but it's one of them.
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(result.dominantColor.slice(i, i + 2), 16)) as [number, number, number];
    expect(g).toBeLessThan(100);
    expect(Math.abs(r - b)).toBeGreaterThan(100);

    for (const variant of result.variants) {
      const meta = await sharp(variant.data).metadata();
      expect(meta.format).toBe('webp');
      expect(meta.width).toBe(variant.width);
      expect(meta.exif).toBeUndefined();
      expect(meta.xmp).toBeUndefined();
      expect(meta.orientation).toBeUndefined();
      expect(variant.bytes).toBe(variant.data.length);
      expect(variant.etag).toMatch(/^"[\w-]{27}"$/);
    }

    // After rotating 90° clockwise, the red (left) half ends up on top.
    const small = result.variants[0]!;
    const { data } = await sharp(small.data).raw().toBuffer({ resolveWithObject: true });
    const pixel = (x: number, y: number): [number, number, number] => {
      const i = (y * small.width + x) * 3;
      return [data[i]!, data[i + 1]!, data[i + 2]!];
    };
    const [topR, , topB] = pixel(80, 40);
    const [bottomR, , bottomB] = pixel(80, 280);
    expect(topR).toBeGreaterThan(topB);
    expect(bottomB).toBeGreaterThan(bottomR);
  });

  it('handles AVIF input', async () => {
    const result = await transformImage(await solidImage('avif', 200, 100, '#10a050'));
    expect(result.variants.map((v) => v.width)).toEqual([160, 200, 200]);
    expect(result.dominantColor).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('throws on undecodable input', async () => {
    await expect(transformImage(Buffer.from([0xff, 0xd8, 0xff, 0x00, 1, 2, 3]))).rejects.toThrow();
  });
});
