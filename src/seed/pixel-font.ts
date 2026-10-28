/**
 * A tiny 5x7 bitmap font, so sample images can contain text without relying on
 * system fonts (slim container images such as node:alpine ship none).
 */
const GLYPHS: Record<string, string[]> = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  G: ['01110', '10001', '10000', '10111', '10001', '10001', '01111'],
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
};

/**
 * Renders text as SVG `<rect>` elements.
 *
 * @param text - Uppercase text; unsupported characters render as blanks
 * @param x - Left edge
 * @param y - Top edge
 * @param scale - Size of one font pixel
 * @param fill - Fill colour
 * @returns SVG markup
 */
export function pixelText(text: string, x: number, y: number, scale: number, fill: string): string {
  const rects: string[] = [];
  [...text.toUpperCase()].forEach((char, index) => {
    const glyph = GLYPHS[char] ?? GLYPHS[' ']!;
    const left = x + index * 6 * scale;
    glyph.forEach((row, rowIndex) => {
      [...row].forEach((bit, colIndex) => {
        if (bit === '1') {
          rects.push(
            `<rect x="${left + colIndex * scale}" y="${y + rowIndex * scale}" width="${scale}" height="${scale}"/>`,
          );
        }
      });
    });
  });
  return `<g fill="${fill}">${rects.join('')}</g>`;
}

/**
 * Width in pixels of `text` rendered by {@link pixelText}.
 *
 * @param text - The text
 * @param scale - Size of one font pixel
 * @returns Width in pixels
 */
export function pixelTextWidth(text: string, scale: number): number {
  return text.length * 6 * scale - scale;
}
