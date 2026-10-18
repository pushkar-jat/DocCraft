/**
 * "Document mode" for camera captures: converts RGBA pixels to greyscale and stretches contrast
 * so the paper becomes near-white and the ink near-black. Works in place on canvas ImageData.
 * The darkest 2% and brightest 2% of pixels are clipped, which ignores specks and glare.
 */
export function enhanceDocument(rgba: Uint8ClampedArray): void {
  const pixels = rgba.length / 4;
  const histogram = new Uint32Array(256);
  const grey = new Uint8Array(pixels);
  for (let i = 0; i < pixels; i++) {
    const value = Math.round(0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2]);
    grey[i] = value;
    histogram[value]++;
  }
  const percentile = (fraction: number) => {
    const target = pixels * fraction;
    let sum = 0;
    for (let v = 0; v < 256; v++) {
      sum += histogram[v];
      if (sum >= target) return v;
    }
    return 255;
  };
  const low = percentile(0.02);
  const high = Math.max(percentile(0.98), low + 1);
  const scale = 255 / (high - low);
  for (let i = 0; i < pixels; i++) {
    const value = Math.min(255, Math.max(0, (grey[i] - low) * scale));
    rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = value;
  }
}

/** DPI that makes an image of `pixelWidth` fill an A4 page width (8.27 in). */
export function a4WidthDpi(pixelWidth: number): number {
  return Math.min(600, Math.max(72, Math.round(pixelWidth / 8.27)));
}
