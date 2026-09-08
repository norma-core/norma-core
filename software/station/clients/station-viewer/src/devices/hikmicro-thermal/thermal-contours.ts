/** Marching squares over a spatially smoothed field; no object detection or history. */
export function thermalContours(values: Float32Array, width: number, height: number, minimumStep: number, rotated: boolean): Float32Array {
  const stride = 4;
  const cols = Math.ceil((width - 1) / stride) + 1;
  const rows = Math.ceil((height - 1) / stride) + 1;
  const field = new Float32Array(cols * rows);
  let lo = Infinity, hi = -Infinity;
  for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
    const x = Math.min(col * stride, width - 1), y = Math.min(row * stride, height - 1);
    let sum = 0, weight = 0;
    // A small triangular filter suppresses sensor grain without following objects.
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const sample = values[Math.max(0, Math.min(height - 1, y + dy)) * width + Math.max(0, Math.min(width - 1, x + dx))];
      const w = (3 - Math.abs(dx)) * (3 - Math.abs(dy));
      sum += sample * w;
      weight += w;
    }
    const value = sum / weight;
    field[row * cols + col] = value;
    if (Number.isFinite(value)) { lo = Math.min(lo, value); hi = Math.max(hi, value); }
  }
  if (!Number.isFinite(lo) || hi - lo < minimumStep) return new Float32Array();
  // Quantized, anchored levels reduce shifts as the scene's extrema change.
  // At most eight levels, with a noise floor for nearly uniform scenes.
  const step = Math.max(minimumStep, 2 ** Math.ceil(Math.log2((hi - lo) / 8)));
  const segments: number[] = [];
  const addPoint = (x: number, y: number) => {
    if (rotated) segments.push(y, width - x);
    else segments.push(x, y);
  };
  for (let level = (Math.floor(lo / step) + 1) * step; level < hi; level += step) {
    for (let row = 0; row < rows - 1; row++) for (let col = 0; col < cols - 1; col++) {
      const index = row * cols + col;
      const v = [field[index], field[index + 1], field[index + cols + 1], field[index + cols]];
      if (!v.every(Number.isFinite)) continue;
      const x0 = col * stride + 0.5, x1 = Math.min((col + 1) * stride, width - 1) + 0.5;
      const y0 = row * stride + 0.5, y1 = Math.min((row + 1) * stride, height - 1) + 0.5;
      const xs = [x0, x1, x1, x0], ys = [y0, y0, y1, y1];
      const crossings: number[][] = [];
      for (let edge = 0; edge < 4; edge++) {
        const next = (edge + 1) % 4;
        if ((v[edge] >= level) === (v[next] >= level)) continue;
        const t = (level - v[edge]) / (v[next] - v[edge]);
        crossings.push([xs[edge] + t * (xs[next] - xs[edge]), ys[edge] + t * (ys[next] - ys[edge])]);
      }
      // Resolve saddle cells consistently with the bilinear center value.
      if (crossings.length === 4 && ((v.reduce((sum, value) => sum + value, 0) / 4 >= level) === (v[0] >= level))) {
        crossings.push(crossings.shift()!);
      }
      for (const [x, y] of crossings) addPoint(x, y);
    }
  }
  return Float32Array.from(segments);
}
