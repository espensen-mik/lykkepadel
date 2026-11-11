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
