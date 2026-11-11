// Auction images: crop to the card format and bake in the site's duotone (brown to cream),
// the same look as .lp-duotone in lp.css. Runs in the browser before upload.

export const RATIO = 10 / 11; // .lp-lot__media is 4 / 4.4
export const OUTPUT = { width: 1000, height: 1100 };
const BROWN = [0x2b, 0x15, 0x13];
const CREAM = [0xff, 0xfc, 0xe0];

export async function loadImage(file) {
  if (!/^image\/(jpeg|png|webp|gif|avif|heic|heif)$/.test(file.type)) throw new Error('Vælg et billede (JPG, PNG eller WebP).');
  if (file.size > 30 * 1024 * 1024) throw new Error('Billedet er for stort. Vælg et under 30 MB.');
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error('Billedet kunne ikke læses. Prøv et JPG eller PNG.');
  }
}

// The part of the source that is kept. focus 0–1 moves the window along the axis with room to spare.
export function cropBox(width, height, focus = { x: 0.5, y: 0.3 }) {
  const wide = width / height > RATIO;
  const w = wide ? height * RATIO : width;
  const h = wide ? height : width / RATIO;
  return { x: (width - w) * focus.x, y: (height - h) * focus.y, w, h };
}

export function render(canvas, image, focus, size = OUTPUT) {
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const box = cropBox(image.width, image.height, focus);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, box.x, box.y, box.w, box.h, 0, 0, size.width, size.height);
  const data = ctx.getImageData(0, 0, size.width, size.height);
  const px = data.data;
  // Grayscale, then contrast 1.15 and brightness 1.05 as in the CSS, then map dark to brown and light to cream.
  const lut = Array.from({ length: 3 }, (_, c) => new Uint8ClampedArray(256));
  for (let v = 0; v < 256; v++) {
    const g = Math.min(1, Math.max(0, ((v / 255 - 0.5) * 1.15 + 0.5) * 1.05));
    for (let c = 0; c < 3; c++) {
      const b = BROWN[c] / 255;
      lut[c][v] = Math.round(CREAM[c] * (b + g * (1 - b)));
    }
  }
  for (let i = 0; i < px.length; i += 4) {
    const l = Math.round(0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]);
    px[i] = lut[0][l];
    px[i + 1] = lut[1][l];
    px[i + 2] = lut[2][l];
    px[i + 3] = 255;
  }
  ctx.putImageData(data, 0, 0);
  return canvas;
}

export function toBlob(canvas) {
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Billedet kunne ikke gemmes.'))), 'image/jpeg', 0.85),
  );
}

// Images that already carry the duotone: uploaded to the bucket.
export const isProcessed = (url) => /\/storage\/v1\/object\/public\/auction-images\//.test(url || '');

// A small editor: choose or drop a file, drag the preview to move the crop, arrow keys nudge it.
export function imageEditor(root, { current, onError }) {
  const preview = root.querySelector('canvas');
  const fallback = root.querySelector('.lp-upload__current');
  const input = root.querySelector('input[type=file]');
  const hint = root.querySelector('.lp-upload__hint');
  let image = null;
  let focus = { x: 0.5, y: 0.3 };
  const PREVIEW = { width: 300, height: 330 };

  const draw = () => image && render(preview, image, focus, PREVIEW);
  const move = (dx, dy) => {
    const box = cropBox(image.width, image.height, focus);
    const spareX = image.width - box.w;
    const spareY = image.height - box.h;
    const clamp = (v) => Math.min(1, Math.max(0, v));
    if (spareX > 1) focus.x = clamp(focus.x - (dx * box.w) / preview.clientWidth / spareX);
    if (spareY > 1) focus.y = clamp(focus.y - (dy * box.h) / preview.clientHeight / spareY);
    draw();
  };

  async function use(file) {
    try {
      image = await loadImage(file);
      focus = { x: 0.5, y: 0.3 };
      preview.hidden = false;
      if (fallback) fallback.hidden = true;
      root.classList.add('has-image');
      hint.textContent = 'Træk i billedet, eller brug piletasterne, for at flytte udsnittet.';
      root.querySelector('.lp-upload__pick span').textContent = 'Skift billede';
      draw();
    } catch (error) {
      onError(error);
    }
  }

  input.onchange = () => input.files[0] && use(input.files[0]);
  root.addEventListener('dragover', (event) => {
    event.preventDefault();
    root.classList.add('is-over');
  });
  root.addEventListener('dragleave', () => root.classList.remove('is-over'));
  root.addEventListener('drop', (event) => {
    event.preventDefault();
    root.classList.remove('is-over');
    const file = event.dataTransfer.files[0];
    if (file) use(file);
  });

  let last = null;
  preview.addEventListener('pointerdown', (event) => {
    if (!image) return;
    last = { x: event.clientX, y: event.clientY };
    preview.setPointerCapture(event.pointerId);
  });
  preview.addEventListener('pointermove', (event) => {
    if (!last) return;
    move(event.clientX - last.x, event.clientY - last.y);
    last = { x: event.clientX, y: event.clientY };
  });
  preview.addEventListener('pointerup', () => (last = null));
  preview.addEventListener('pointercancel', () => (last = null));
  preview.addEventListener('keydown', (event) => {
    const step = { ArrowLeft: [8, 0], ArrowRight: [-8, 0], ArrowUp: [0, 8], ArrowDown: [0, -8] }[event.key];
    if (!step || !image) return;
    event.preventDefault();
    move(...step);
  });

  return {
    get changed() {
      return Boolean(image);
    },
    current,
    // Full-size result for upload.
    async blob() {
      return toBlob(render(document.createElement('canvas'), image, focus));
    },
  };
}
