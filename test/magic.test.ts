import { describe, expect, it } from 'vitest';
import { detectImageType } from '../src/images/magic.js';
import { solidImage } from './support/images.js';

describe('detectImageType', () => {
  it.each(['jpeg', 'png', 'webp', 'avif'] as const)('recognises a real %s file', async (format) => {
    expect(detectImageType(await solidImage(format))).toBe(format);
  });

  it('recognises an AVIF whose brand is only listed as compatible', () => {
    const box = Buffer.alloc(24);
    box.writeUInt32BE(24, 0);
    box.write('ftypmif1', 4, 'latin1');
    box.write('miafavif', 16, 'latin1');
    expect(detectImageType(box)).toBe('avif');
  });

  it('rejects other ISO-BMFF files such as HEIC and MP4', () => {
    const heic = Buffer.alloc(24);
    heic.writeUInt32BE(24, 0);
    heic.write('ftypheic\0\0\0\0mif1heic', 4, 'latin1');
    const mp4 = Buffer.alloc(24);
    mp4.writeUInt32BE(24, 0);
    mp4.write('ftypisom\0\0\0\0isomiso2', 4, 'latin1');
    expect(detectImageType(heic)).toBeNull();
    expect(detectImageType(mp4)).toBeNull();
  });

  it('rejects GIF, SVG, text and empty input regardless of file name', () => {
    expect(detectImageType(Buffer.from('GIF89a\x01\x00\x01\x00', 'latin1'))).toBeNull();
    expect(detectImageType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBeNull();
    expect(detectImageType(Buffer.from('definitely-a-photo.jpg'))).toBeNull();
    expect(detectImageType(Buffer.alloc(0))).toBeNull();
  });

  it('rejects a RIFF container that is not WebP (e.g. WAV)', () => {
    expect(detectImageType(Buffer.from('RIFF\x24\x00\x00\x00WAVEfmt ', 'latin1'))).toBeNull();
  });

  it('rejects truncated signatures', () => {
    expect(detectImageType(Buffer.from([0xff, 0xd8]))).toBeNull();
    expect(detectImageType(Buffer.from([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
  });
});
