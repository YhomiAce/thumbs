import sharp from 'sharp';
import { pixelText, pixelTextWidth } from './pixel-font.js';

const WIDTH = 1600;
const HEIGHT = 1000;

/** A generated sample image. */
export interface SampleImage {
  name: string;
  mimeType: string;
  data: Buffer;
}

function titled(title: string, body: string, ink: string): string {
  const scale = 22;
  const x = Math.round((WIDTH - pixelTextWidth(title, scale)) / 2);
  const y = Math.round(HEIGHT / 2 - (7 * scale) / 2);
  const sub = 'THUMBS SAMPLE';
  const subScale = 6;
  const subX = Math.round((WIDTH - pixelTextWidth(sub, subScale)) / 2);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}">${body}${pixelText(
    title,
    x,
    y,
    scale,
    ink,
  )}${pixelText(sub, subX, y + 7 * scale + 40, subScale, ink)}</svg>`;
}

function aurora(): string {
  const bands = Array.from({ length: 7 }, (_, i) => {
    const y = 120 + i * 90;
    return `<path d="M0 ${y} C 400 ${y - 160}, 1200 ${y + 160}, 1600 ${y - 40}" stroke="hsl(${140 + i * 18} 80% 60%)" stroke-opacity="0.35" stroke-width="60" fill="none"/>`;
  }).join('');
  return titled(
    'AURORA',
    `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0b1b3a"/><stop offset="1" stop-color="#1d4e5f"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/>${bands}`,
    '#f5f7ff',
  );
}

function dunes(): string {
  const ridges = Array.from({ length: 6 }, (_, i) => {
    const y = 420 + i * 100;
    return `<path d="M0 ${y} Q 400 ${y - 120} 800 ${y} T 1600 ${y} V 1000 H 0 Z" fill="hsl(${32 - i * 3} ${70 - i * 4}% ${62 - i * 7}%)"/>`;
  }).join('');
  return titled(
    'DUNES',
    `<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffcf8a"/><stop offset="1" stop-color="#ff8c5a"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#s)"/><circle cx="1220" cy="260" r="120" fill="#fff3d1"/>${ridges}`,
    '#3a1f0e',
  );
}

function lagoon(): string {
  const dots: string[] = [];
  for (let row = 0; row < 12; row++) {
    for (let col = 0; col < 20; col++) {
      const r = 10 + ((row * 7 + col * 3) % 18);
      dots.push(`<circle cx="${col * 84 + (row % 2) * 42}" cy="${row * 90}" r="${r}" fill="#ffffff" fill-opacity="0.12"/>`);
    }
  }
  return titled(
    'LAGOON',
    `<defs><radialGradient id="w" cx="0.3" cy="0.3" r="0.9"><stop offset="0" stop-color="#5ee7df"/><stop offset="1" stop-color="#1e5f9e"/></radialGradient></defs><rect width="100%" height="100%" fill="url(#w)"/>${dots.join('')}`,
    '#06243f',
  );
}

/**
 * Generates three sample photos-sized images (JPEG, PNG and WebP) with sharp,
 * so a fresh install has something in the gallery.
 *
 * @returns The sample images
 */
export async function generateSamples(): Promise<SampleImage[]> {
  return [
    { name: 'aurora.jpg', mimeType: 'image/jpeg', data: await sharp(Buffer.from(aurora())).jpeg({ quality: 90 }).toBuffer() },
    { name: 'dunes.png', mimeType: 'image/png', data: await sharp(Buffer.from(dunes())).png().toBuffer() },
    { name: 'lagoon.webp', mimeType: 'image/webp', data: await sharp(Buffer.from(lagoon())).webp({ quality: 92 }).toBuffer() },
  ];
}
