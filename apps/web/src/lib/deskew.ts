// Straighten receipt photos before OCR. A tilted photo makes printed lines slant, so an item
// and its price can look like they sit on different lines.
//
// Skew is found with a projection profile: pick out the ink (text strokes), then try candidate
// angles. At the true angle each printed line collapses into a narrow band of rows, so the
// row histogram becomes sharply peaked — the angle with the peakiest histogram wins.

const MAX_SKEW_DEG = 15;
const MIN_CORRECTION_DEG = 0.5; // below this, rotating only softens the text
const ANALYSIS_SIZE = 600; // long edge of the downscaled copy used for detection
const OUTPUT_SIZE = 1568; // Claude downsizes anything larger, so don't upload more than this

/**
 * Estimate text skew in degrees from a grayscale image (0–255, row-major).
 * Positive means lines slope down to the right; rotate by the negative to straighten.
 */
export function detectSkew(gray: Uint8ClampedArray | Float32Array, w: number, h: number): number {
  // Ink = pixels clearly darker than their neighbourhood (adaptive threshold). This picks out
  // text strokes and ignores large uniform areas like a dark table around the receipt.
  const integral = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let rowSum = 0;
    for (let x = 0; x < w; x++) {
      rowSum += gray[y * w + x];
      integral[(y + 1) * (w + 1) + x + 1] = integral[y * (w + 1) + x + 1] + rowSum;
    }
  }
  const r = Math.max(4, Math.round(Math.min(w, h) / 40));
  const xs: number[] = [];
  const ys: number[] = [];
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
      const area = (y1 - y0) * (x1 - x0);
      const sum = integral[y1 * (w + 1) + x1] - integral[y0 * (w + 1) + x1] - integral[y1 * (w + 1) + x0] + integral[y0 * (w + 1) + x0];
      if (gray[y * w + x] < (sum / area) * 0.8) { xs.push(x); ys.push(y); }
    }
  }
  if (xs.length < 200) return 0; // not enough text to judge

  const cx = w / 2, cy = h / 2;
  const diag = Math.ceil(Math.hypot(w, h));
  const bins = new Float64Array(diag + 2);
  const score = (deg: number) => {
    const a = (deg * Math.PI) / 180, sin = Math.sin(a), cos = Math.cos(a);
    bins.fill(0);
    for (let i = 0; i < xs.length; i++) {
      // Row of this ink pixel after rotating the image by -deg about its centre
      const row = Math.round((ys[i] - cy) * cos - (xs[i] - cx) * sin + diag / 2);
      if (row >= 0 && row < bins.length) bins[row]++;
    }
    let s = 0;
    for (let i = 0; i < bins.length; i++) s += bins[i] * bins[i];
    return s;
  };

  // Coarse sweep, then refine around the best angle
  let best = 0, bestScore = score(0);
  for (let d = -MAX_SKEW_DEG; d <= MAX_SKEW_DEG; d += 0.5) {
    const s = score(d);
    if (s > bestScore) { best = d; bestScore = s; }
  }
  const coarse = best;
  for (let d = coarse - 0.5; d <= coarse + 0.5; d += 0.1) {
    const s = score(d);
    if (s > bestScore) { best = d; bestScore = s; }
  }
  return Math.round(best * 10) / 10;
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    // Browsers apply the photo's EXIF orientation when decoding into an <img>
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read image')); };
    img.src = url;
  });
}

/** Straighten and downsize a receipt photo; returns base64 JPEG ready for OCR. */
export async function prepareReceiptImage(file: File): Promise<{ base64: string; mimeType: 'image/jpeg'; skew: number }> {
  const img = await loadImage(file);
  const iw = img.naturalWidth, ih = img.naturalHeight;

  // Detect skew on a small grayscale copy
  const aScale = Math.min(1, ANALYSIS_SIZE / Math.max(iw, ih));
  const aw = Math.round(iw * aScale), ah = Math.round(ih * aScale);
  const aCanvas = document.createElement('canvas');
  aCanvas.width = aw; aCanvas.height = ah;
  const actx = aCanvas.getContext('2d', { willReadFrequently: true })!;
  actx.drawImage(img, 0, 0, aw, ah);
  const rgba = actx.getImageData(0, 0, aw, ah).data;
  const gray = new Uint8ClampedArray(aw * ah);
  for (let i = 0; i < gray.length; i++) {
    gray[i] = 0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2];
  }
  const skew = detectSkew(gray, aw, ah);
  const angle = Math.abs(skew) >= MIN_CORRECTION_DEG ? (-skew * Math.PI) / 180 : 0;

  // Render the output: rotated about the centre onto a canvas big enough to hold it, white fill
  const oScale = Math.min(1, OUTPUT_SIZE / Math.max(iw, ih));
  const sw = iw * oScale, sh = ih * oScale;
  const cos = Math.abs(Math.cos(angle)), sin = Math.abs(Math.sin(angle));
  let ow = sw * cos + sh * sin, oh = sw * sin + sh * cos;
  const fit = Math.min(1, OUTPUT_SIZE / Math.max(ow, oh));
  ow = Math.round(ow * fit); oh = Math.round(oh * fit);

  const out = document.createElement('canvas');
  out.width = ow; out.height = oh;
  const ctx = out.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, ow, oh);
  ctx.translate(ow / 2, oh / 2);
  ctx.rotate(angle);
  ctx.scale(fit, fit);
  ctx.drawImage(img, -sw / 2, -sh / 2, sw, sh);

  const base64 = out.toDataURL('image/jpeg', 0.9).split(',')[1];
  return { base64, mimeType: 'image/jpeg', skew };
}
