// Catmull-Rom through the sampled pointer path, emitted as cubic Béziers —
// the strokes read as ink, not as chained line segments. Data unchanged:
// smoothing happens at render time only.

export interface CurveSeg {
  c1x: number;
  c1y: number;
  c2x: number;
  c2y: number;
  x: number;
  y: number;
}

export interface Curve {
  x0: number;
  y0: number;
  segs: CurveSeg[];
}

export function buildCurve(points: number[], scale: number): Curve | null {
  const n = points.length / 2;
  if (n < 2) return null;
  const clamp = (i: number) => Math.min(Math.max(i, 0), n - 1);
  const px = (i: number) => points[2 * clamp(i)] * scale;
  const py = (i: number) => points[2 * clamp(i) + 1] * scale;
  const segs: CurveSeg[] = [];
  for (let i = 0; i < n - 1; i++) {
    segs.push({
      c1x: px(i) + (px(i + 1) - px(i - 1)) / 6,
      c1y: py(i) + (py(i + 1) - py(i - 1)) / 6,
      c2x: px(i + 1) - (px(i + 2) - px(i)) / 6,
      c2y: py(i + 1) - (py(i + 2) - py(i)) / 6,
      x: px(i + 1),
      y: py(i + 1),
    });
  }
  return { x0: px(0), y0: py(0), segs };
}
