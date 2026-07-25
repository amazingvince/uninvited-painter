// Stroke geometry shared by the engine (validation), the archive endpoint and
// the client (ink meter, rendering) — one definition of "how much ink is that".

import type { StrokePoints } from "./types";

/** Split a flat coordinate list into segments at the given pair indices. */
export function splitSegments(points: StrokePoints, breaks: number[] = []): StrokePoints[] {
  if (breaks.length === 0) return [points];
  const segments: StrokePoints[] = [];
  let start = 0;
  for (const b of breaks) {
    segments.push(points.slice(start * 2, b * 2));
    start = b;
  }
  segments.push(points.slice(start * 2));
  return segments;
}

/** Are the break indices coherent (sorted, in range, min 2 samples/segment)? */
export function validSegments(points: StrokePoints, breaks: number[] = []): boolean {
  if (points.length % 2 !== 0) return false;
  const pairs = points.length / 2;
  let prev = 0;
  for (const b of breaks) {
    if (!Number.isInteger(b) || b <= prev + 1 || b >= pairs) return false;
    prev = b;
  }
  return pairs - prev >= 2;
}

/** Total inked path length in canvas units (segment gaps don't count). */
export function strokeLength(points: StrokePoints, breaks: number[] = []): number {
  let total = 0;
  for (const seg of splitSegments(points, breaks)) {
    for (let i = 2; i < seg.length; i += 2) {
      total += Math.hypot(seg[i] - seg[i - 2], seg[i + 1] - seg[i - 1]);
    }
  }
  return total;
}
