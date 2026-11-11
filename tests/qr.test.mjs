import { test } from 'node:test';
import assert from 'node:assert/strict';
import { qrMatrix, qrSvg } from '../src/qr.js';

// Decoding was checked in a browser with BarcodeDetector for versions 1–6; this guards the structure.
test('picks the smallest version and draws the finder patterns', () => {
  assert.equal(qrMatrix('A').length, 21);
  const ticket = qrMatrix('https://www.lykkepadel.dk/admin#billet/AB12-CD34');
  assert.equal(ticket.length, 33);
  for (const [x, y] of [[0, 0], [ticket.length - 7, 0], [0, ticket.length - 7]]) {
    assert.equal(ticket[y][x], true);
    assert.equal(ticket[y + 1][x + 1], false);
    assert.equal(ticket[y + 3][x + 3], true);
  }
  assert.equal(ticket[ticket.length - 8][8], true, 'dark module');
});

test('refuses text that is too long and returns an svg', () => {
  assert.throws(() => qrMatrix('x'.repeat(107)), /for lang/);
  assert.match(qrSvg('A'), /^<svg[^>]+viewBox="0 0 29 29"/);
});

// The scanner reads tickets with jsQR on iPhone; it must read the codes we draw.
test('jsQR reads the ticket QR codes', async () => {
  const { default: jsQR } = await import('jsqr');
  for (const text of ['https://www.lykkepadel.dk/scan#AB12-CD34', 'https://www.lykkepadel.dk/scan#0F9E-77A1']) {
    const modules = qrMatrix(text);
    const scale = 6;
    const size = (modules.length + 8) * scale;
    const pixels = new Uint8ClampedArray(size * size * 4).fill(255);
    modules.forEach((row, y) => row.forEach((dark, x) => {
      if (!dark) return;
      for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
        const i = (((y + 4) * scale + dy) * size + (x + 4) * scale + dx) * 4;
        pixels[i] = pixels[i + 1] = pixels[i + 2] = 0;
      }
    }));
    assert.equal(jsQR(pixels, size, size)?.data, text);
  }
});
