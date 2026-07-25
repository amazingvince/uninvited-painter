// The shared drawing surface. Square, normalised 0–1 coordinates so every
// screen size agrees. Strokes are pointer paths with round caps, stored as
// arrays and re-rendered on resize — never as bitmaps.

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { SEAT_COLORS } from "../../shared/palette";
import { MIN_STROKE_COORDS } from "../../shared/types";
import type { Stroke, StrokePoints } from "../../shared/types";
import { splitSegments } from "../../shared/geometry";
import { buildCurve } from "../lib/curves";

const VIEW = 1000;
const STROKE_W = 17;
/** Skip samples closer than this (normalised) — keeps strokes light. */
const MIN_STEP = 0.004;
const MAX_POINTS = 1200; // coords, i.e. 600 samples

export function strokePath(points: StrokePoints, breaks: number[] = []): string {
  let d = "";
  for (const seg of splitSegments(points, breaks)) {
    const curve = buildCurve(seg, VIEW);
    if (!curve) continue;
    d += `M${curve.x0.toFixed(1)} ${curve.y0.toFixed(1)}`;
    for (const s of curve.segs) {
      d += `C${s.c1x.toFixed(1)} ${s.c1y.toFixed(1)} ${s.c2x.toFixed(1)} ${s.c2y.toFixed(1)} ${s.x.toFixed(1)} ${s.y.toFixed(1)}`;
    }
  }
  return d;
}

export function StrokePaths({
  strokes,
  width = STROKE_W,
  highlight,
}: {
  strokes: Stroke[];
  width?: number;
  /** Player id whose strokes stay in colour — everyone else's fade to grey. */
  highlight?: string | null;
}) {
  let ordered = strokes.map((s, i) => ({ s, i }));
  if (highlight) {
    // The suspect's lines render last so nothing occludes them.
    ordered = [
      ...ordered.filter(({ s }) => s.playerId !== highlight),
      ...ordered.filter(({ s }) => s.playerId === highlight),
    ];
  }
  return (
    <>
      {ordered.map(({ s, i }) => (
        <path
          key={i}
          d={strokePath(s.points, s.breaks)}
          stroke={
            highlight && s.playerId !== highlight
              ? "#c9c2b0"
              : (SEAT_COLORS[s.colorIndex] ?? "#121212")
          }
          strokeWidth={width}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ transition: "stroke 0.25s ease" }}
        />
      ))}
    </>
  );
}

export interface LiveStroke {
  colorIndex: number;
  points: StrokePoints;
  breaks?: number[];
}

interface CanvasBoardProps {
  strokes: Stroke[];
  /** In-progress remote stroke(s), keyed by player — drawn with a moving nib. */
  live?: Record<string, LiveStroke>;
  /** Your own uncommitted stroke — rendered dashed while the grace clock runs. */
  pending?: LiveStroke | null;
  corner?: ReactNode;
  drawing?: {
    colorIndex: number;
    /** Called with a raw batch of new coords as the pointer moves. */
    onLive?: (batch: StrokePoints) => void;
    /** Pen up with a full valid stroke. */
    onPenUp: (points: StrokePoints) => void;
    /** Fewer than 3 points — a mis-tap. */
    onMisTap?: () => void;
    /** Ink left for this gesture (normalised units) — the pen runs dry at 0. */
    inkRemaining?: number;
    disabled?: boolean;
  };
}

export function CanvasBoard({ strokes, live, pending, corner, drawing }: CanvasBoardProps) {
  const boardRef = useRef<HTMLDivElement>(null);
  const pointsRef = useRef<number[]>([]);
  const gestureLen = useRef(0);
  const activePointer = useRef<number | null>(null);
  const [draft, setDraft] = useState<StrokePoints | null>(null);

  const drawingRef = useRef(drawing);
  drawingRef.current = drawing;

  useEffect(() => {
    const el = boardRef.current;
    if (!el) return;

    const norm = (e: PointerEvent): [number, number] => {
      const rect = el.getBoundingClientRect();
      const x = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
      const y = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
      return [x, y];
    };

    const finish = () => {
      activePointer.current = null;
      const d = drawingRef.current;
      const pts = pointsRef.current;
      pointsRef.current = [];
      gestureLen.current = 0;
      setDraft(null);
      if (!d) return;
      if (pts.length < MIN_STROKE_COORDS) {
        d.onMisTap?.();
        return;
      }
      d.onPenUp(pts);
    };

    const down = (e: PointerEvent) => {
      const d = drawingRef.current;
      if (!d || d.disabled) return;
      if (activePointer.current !== null) {
        // A second finger while a captured pointer is live is ignored — but a
        // stale pointer from an interrupted gesture (lost pointerup) must not
        // wedge the turn.
        if (el.hasPointerCapture?.(activePointer.current)) return;
        activePointer.current = null;
        pointsRef.current = [];
      }
      if (d.inkRemaining !== undefined && d.inkRemaining <= 0.01) return; // pen is dry
      e.preventDefault();
      activePointer.current = e.pointerId;
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        // Best-effort — pointerup/cancel handlers still end the stroke.
      }
      const [x, y] = norm(e);
      pointsRef.current = [x, y];
      gestureLen.current = 0;
      setDraft([x, y]);
      d.onLive?.([x, y]);
    };

    const move = (e: PointerEvent) => {
      const d = drawingRef.current;
      if (!d || activePointer.current !== e.pointerId) return;
      e.preventDefault();
      const pts = pointsRef.current;
      if (pts.length >= MAX_POINTS) return;
      let [x, y] = norm(e);
      const lx = pts[pts.length - 2];
      const ly = pts[pts.length - 1];
      const dist = Math.hypot(x - lx, y - ly);
      if (dist < MIN_STEP) return;
      if (d.inkRemaining !== undefined && gestureLen.current + dist >= d.inkRemaining) {
        // The pen runs dry mid-motion: clamp to the last affordable point and end.
        const t = Math.max(0, (d.inkRemaining - gestureLen.current) / dist);
        x = lx + (x - lx) * t;
        y = ly + (y - ly) * t;
        if (t > 0.05) {
          pts.push(x, y);
          d.onLive?.([x, y]);
        }
        finish();
        return;
      }
      gestureLen.current += dist;
      pts.push(x, y);
      setDraft([...pts]);
      d.onLive?.([x, y]);
    };

    const up = (e: PointerEvent) => {
      if (activePointer.current !== e.pointerId) return;
      finish();
    };

    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    return () => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
    };
  }, []);

  const liveEntries = Object.entries(live ?? {});

  return (
    <div className="board" ref={boardRef}>
      <svg viewBox={`0 0 ${VIEW} ${VIEW}`}>
        <StrokePaths strokes={strokes} />
        {liveEntries.map(([pid, s]) => (
          <path
            key={pid}
            d={strokePath(s.points, s.breaks)}
            stroke={SEAT_COLORS[s.colorIndex]}
            strokeWidth={STROKE_W}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
        {pending && (
          <path
            d={strokePath(pending.points, pending.breaks)}
            stroke={SEAT_COLORS[pending.colorIndex]}
            strokeWidth={STROKE_W}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray="17 28"
          />
        )}
        {draft && drawing && (
          <path
            d={strokePath(draft)}
            stroke={SEAT_COLORS[drawing.colorIndex]}
            strokeWidth={STROKE_W}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
      </svg>
      {liveEntries.map(([pid, s]) => {
        const n = s.points.length;
        if (n < 2) return null;
        return (
          <div
            key={pid}
            className="nib"
            style={{
              left: `${s.points[n - 2] * 100}%`,
              top: `${s.points[n - 1] * 100}%`,
              background: SEAT_COLORS[s.colorIndex],
              boxShadow: `0 0 0 5px ${SEAT_COLORS[s.colorIndex]}40`,
            }}
          />
        );
      })}
      {corner !== undefined && <div className="board-corner">{corner}</div>}
    </div>
  );
}
