import { describe, expect, it } from 'vitest';
import { formatBytes, isVariantSize, planVariants, savingsPercent, VARIANT_SIZES } from '../src/images/variants.js';

describe('planVariants', () => {
  it('scales a large landscape image to each width, keeping the aspect ratio', () => {
    expect(planVariants(4000, 3000)).toEqual([
      { size: 160, width: 160, height: 120 },
      { size: 480, width: 480, height: 360 },
      { size: 1280, width: 1280, height: 960 },
    ]);
  });

  it('never enlarges: narrower originals keep their width for the bigger sizes', () => {
    expect(planVariants(300, 600)).toEqual([
      { size: 160, width: 160, height: 320 },
      { size: 480, width: 300, height: 600 },
      { size: 1280, width: 300, height: 600 },
    ]);
  });

  it('keeps at least 1px of height for extreme panoramas', () => {
    expect(planVariants(20000, 10)[0]).toEqual({ size: 160, width: 160, height: 1 });
  });

  it('rejects invalid dimensions', () => {
    expect(() => planVariants(0, 100)).toThrow(RangeError);
    expect(() => planVariants(10.5, 100)).toThrow(RangeError);
  });
});

describe('helpers', () => {
  it('knows the variant sizes', () => {
    expect(VARIANT_SIZES).toEqual([160, 480, 1280]);
    expect(isVariantSize(480)).toBe(true);
    expect(isVariantSize(500)).toBe(false);
  });

  it('computes savings', () => {
    expect(savingsPercent(1000, 66)).toBe(93.4);
    expect(savingsPercent(100, 150)).toBe(-50);
    expect(savingsPercent(0, 10)).toBe(0);
  });

  it('formats bytes', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(12_595)).toBe('12.3 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
  });
});
