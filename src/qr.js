// A small QR code generator for ticket links: byte mode, error correction level M, versions 1–6
// (up to 106 bytes). Follows the QR standard (ISO/IEC 18004), structured like Nayuki's reference code.

// Error correction for level M: [codewords per block for error correction, number of blocks].
const ECC_M = [null, [10, 1], [16, 1], [26, 1], [18, 2], [24, 2], [16, 4]];
const TOTAL = [null, 26, 44, 70, 100, 134, 172];

function gfMultiply(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}

function rsDivisor(degree) {
  const result = new Array(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = gfMultiply(result[j], root);
      if (j + 1 < result.length) result[j] ^= result[j + 1];
    }
    root = gfMultiply(root, 0x02);
  }
  return result;
}

function rsRemainder(data, divisor) {
  const result = divisor.map(() => 0);
  for (const b of data) {
    const factor = b ^ result.shift();
    result.push(0);
    divisor.forEach((coef, i) => (result[i] ^= gfMultiply(coef, factor)));
  }
  return result;
}

function encodeData(bytes, version) {
  const [ecLen, blocks] = ECC_M[version];
  const dataLen = TOTAL[version] - ecLen * blocks;
  const bits = [];
  const push = (value, length) => {
    for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  push(0b0100, 4);
  push(bytes.length, 8);
  for (const b of bytes) push(b, 8);
  push(0, Math.min(4, dataLen * 8 - bits.length));
  push(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < dataLen * 8; pad ^= 0xec ^ 0x11) push(pad, 8);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));

  // All level M blocks for versions 1–6 have the same length, so interleaving is straightforward.
  const size = dataLen / blocks;
  const divisor = rsDivisor(ecLen);
  const parts = Array.from({ length: blocks }, (_, i) => data.slice(i * size, (i + 1) * size));
  const ecc = parts.map((part) => rsRemainder(part, divisor));
  const result = [];
  for (let i = 0; i < size; i++) for (const part of parts) result.push(part[i]);
  for (let i = 0; i < ecLen; i++) for (const part of ecc) result.push(part[i]);
  return result;
}

const MASKS = [
  (x, y) => (x + y) % 2 === 0,
  (x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

export function qrMatrix(text) {
  const bytes = [...new TextEncoder().encode(text)];
  const version = [1, 2, 3, 4, 5, 6].find((v) => TOTAL[v] - ECC_M[v][0] * ECC_M[v][1] - 2 >= bytes.length);
  if (!version) throw new Error('Teksten er for lang til QR-koden.');
  const size = version * 4 + 17;
  const modules = Array.from({ length: size }, () => new Array(size).fill(false));
  const isFunction = Array.from({ length: size }, () => new Array(size).fill(false));
  const set = (x, y, dark) => {
    modules[y][x] = dark;
    isFunction[y][x] = true;
  };

  for (let i = 0; i < size; i++) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, dist !== 2 && dist !== 4);
      }
    }
  }
  if (version >= 2) {
    const c = size - 7;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(c + dx, c + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }

  const drawFormat = (mask) => {
    const data = (0b00 << 3) | mask; // level M
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((data << 10) | rem) ^ 0x5412;
    const bit = (i) => ((bits >>> i) & 1) !== 0;
    for (let i = 0; i <= 5; i++) set(8, i, bit(i));
    set(8, 7, bit(6));
    set(8, 8, bit(7));
    set(7, 8, bit(8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
    set(8, size - 8, true);
  };
  drawFormat(0);

  const codewords = encodeData(bytes, version);
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (!isFunction[y][x] && i < codewords.length * 8) {
          modules[y][x] = ((codewords[i >>> 3] >>> (7 - (i & 7))) & 1) !== 0;
          i++;
        }
      }
    }
  }

  const apply = (mask) => {
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!isFunction[y][x] && MASKS[mask](x, y)) modules[y][x] = !modules[y][x];
  };
  // Simplified penalty (runs, 2×2 blocks, balance): any mask decodes; this only picks a tidier one.
  const penalty = () => {
    let score = 0;
    for (let a = 0; a < size; a++) {
      for (const line of [(b) => modules[a][b], (b) => modules[b][a]]) {
        let run = 1;
        for (let b = 1; b <= size; b++) {
          if (b < size && line(b) === line(b - 1)) run++;
          else {
            if (run >= 5) score += run - 2;
            run = 1;
          }
        }
      }
    }
    for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) {
      const c = modules[y][x];
      if (c === modules[y][x + 1] && c === modules[y + 1][x] && c === modules[y + 1][x + 1]) score += 3;
    }
    const dark = modules.flat().filter(Boolean).length;
    score += Math.floor(Math.abs(dark * 20 - size * size * 10) / (size * size)) * 10;
    return score;
  };
  let best = 0;
  let bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    apply(mask);
    drawFormat(mask);
    const score = penalty();
    if (score < bestScore) {
      best = mask;
      bestScore = score;
    }
    apply(mask);
  }
  apply(best);
  drawFormat(best);
  return modules;
}

export function qrSvg(text, { label = 'QR-kode' } = {}) {
  const modules = qrMatrix(text);
  const size = modules.length + 8;
  let path = '';
  modules.forEach((row, y) => row.forEach((dark, x) => dark && (path += `M${x + 4} ${y + 4}h1v1h-1z`)));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" role="img" aria-label="${label}" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
}
