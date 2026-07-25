// B5 Your turn. Two pens:
//  - "line": one unbroken line — lifting opens a 4s grace window (undo
//    restores a blank turn), then commits.
//  - "free": draw several segments inside the ink budget; an explicit
//    End Turn submits, Undo removes the last line.

import { useEffect, useRef, useState } from "react";
import { strokeLength } from "../../shared/geometry";
import { GRACE_MS } from "../../shared/types";
import type { PenMode, Stroke, StrokePoints } from "../../shared/types";
import { CanvasBoard } from "../components/CanvasBoard";
import { ClockChip, Screen, Swatch } from "../components/ui";

export function DrawTurn({
  word,
  category,
  colorIndex,
  strokes,
  strokeNo,
  strokeTotal,
  youLabel = "You",
  paused = false,
  deadline: clockDeadline,
  penMode = "line",
  inkLimit = 0,
  onLive,
  onLiveClear,
  onCommit,
}: {
  /** Real artists see the word in the header; the fake sees the category. */
  word: string | null;
  category: string;
  colorIndex: number;
  strokes: Stroke[];
  strokeNo: number;
  strokeTotal: number;
  youLabel?: string;
  /** A seat is being held — freeze the grace clock and the pen. */
  paused?: boolean;
  /** Stroke-clock deadline, when the room plays with one. */
  deadline?: number | null;
  penMode?: PenMode;
  /** Ink budget per turn as % of canvas width (0 = unlimited). */
  inkLimit?: number;
  onLive?: (batch: StrokePoints, newSegment?: boolean) => void;
  onLiveClear?: () => void;
  onCommit: (points: StrokePoints, breaks?: number[]) => void;
}) {
  // ---- line mode state (grace window) ----
  const [pending, setPending] = useState<StrokePoints | null>(null);
  const [deadline, setDeadline] = useState<number | null>(null);
  const [remaining, setRemaining] = useState(GRACE_MS);
  const pendingRef = useRef<StrokePoints | null>(null);
  const frozenRemaining = useRef<number | null>(null);

  // ---- free mode state (segments + ink) ----
  const [segs, setSegs] = useState<StrokePoints[]>([]);
  const segStartPending = useRef(false);

  const [misTap, setMisTap] = useState(false);

  const budget = inkLimit > 0 ? inkLimit / 100 : Infinity;
  const inkUsed = penMode === "free" ? segs.reduce((sum, s) => sum + strokeLength(s), 0) : 0;
  const inkLeft = budget - inkUsed;

  // A pause freezes the grace clock; the leftover time resumes with the game.
  useEffect(() => {
    if (paused) {
      if (deadline !== null) {
        frozenRemaining.current = Math.max(1000, deadline - Date.now());
        setDeadline(null);
      }
    } else if (frozenRemaining.current !== null && pendingRef.current) {
      setDeadline(Date.now() + frozenRemaining.current);
      frozenRemaining.current = null;
    }
  }, [paused, deadline]);

  useEffect(() => {
    if (deadline === null) return;
    const id = setInterval(() => {
      const left = deadline - Date.now();
      if (left <= 0) {
        clearInterval(id);
        const pts = pendingRef.current;
        if (pts) {
          pendingRef.current = null;
          setPending(null);
          setDeadline(null);
          onCommit(pts);
        }
      } else {
        setRemaining(left);
      }
    }, 50);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deadline]);

  /** Rebuild the spectators' live overlay from the kept segments. */
  const resendLive = (kept: StrokePoints[]) => {
    onLiveClear?.();
    kept.forEach((seg, i) => onLive?.(seg, i > 0));
  };

  const penUp = (points: StrokePoints) => {
    setMisTap(false);
    if (penMode === "free") {
      setSegs((prev) => [...prev, points]);
      segStartPending.current = true;
      return;
    }
    pendingRef.current = points;
    setPending(points);
    // The grace window never outlives the stroke clock — a line drawn in time
    // must commit before the server forfeits the turn.
    const grace =
      clockDeadline != null
        ? Math.max(600, Math.min(GRACE_MS, clockDeadline - Date.now() - 1200))
        : GRACE_MS;
    setRemaining(grace);
    setDeadline(Date.now() + grace);
  };

  const undoLine = () => {
    pendingRef.current = null;
    setPending(null);
    setDeadline(null);
    onLiveClear?.();
  };

  const undoSegment = () => {
    setSegs((prev) => {
      const kept = prev.slice(0, -1);
      resendLive(kept);
      return kept;
    });
    segStartPending.current = true;
  };

  const commitNow = () => {
    if (penMode === "free") {
      if (segs.length === 0) return;
      const points = segs.flat();
      const breaks: number[] = [];
      let offset = 0;
      for (const seg of segs.slice(0, -1)) {
        offset += seg.length / 2;
        breaks.push(offset);
      }
      setSegs([]);
      segStartPending.current = false;
      onCommit(points, breaks.length > 0 ? breaks : undefined);
      return;
    }
    const pts = pendingRef.current;
    if (!pts) return;
    pendingRef.current = null;
    setPending(null);
    setDeadline(null);
    onCommit(pts);
  };

  const freePending =
    penMode === "free" && segs.length > 0
      ? {
          colorIndex,
          points: segs.flat(),
          breaks: (() => {
            const b: number[] = [];
            let offset = 0;
            for (const seg of segs.slice(0, -1)) {
              offset += seg.length / 2;
              b.push(offset);
            }
            return b;
          })(),
        }
      : null;

  const canDraw = penMode === "free" ? inkLeft > 0.01 : pending === null;

  const header = (
    <div className="header header-row">
      <div style={{ minWidth: 0 }}>
        <div className="kicker u-muted" style={{ display: "flex", gap: 10 }}>
          <span>Your stroke</span>
          <ClockChip deadline={clockDeadline} />
        </div>
        <div className="shout" style={{ fontSize: word && word.length > 14 ? 20 : 26, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {word ?? `${category} · ???`}
        </div>
      </div>
      <div className="kicker" style={{ display: "flex", alignItems: "center", gap: 7, letterSpacing: "0.12em", flex: "none" }}>
        <Swatch index={colorIndex} />
        {youLabel}
      </div>
    </div>
  );

  return (
    <Screen>
      {header}
      <CanvasBoard
        strokes={strokes}
        pending={penMode === "free" ? freePending : pending ? { colorIndex, points: pending } : null}
        corner={`${String(strokeNo).padStart(2, "0")} / ${strokeTotal}`}
        drawing={
          canDraw
            ? {
                colorIndex,
                onLive: (batch) => {
                  const mark = penMode === "free" && segStartPending.current;
                  segStartPending.current = false;
                  onLive?.(batch, mark);
                },
                onPenUp: penUp,
                disabled: paused,
                inkRemaining:
                  inkLimit > 0
                    ? penMode === "free"
                      ? Math.max(0, inkLeft)
                      : budget
                    : undefined,
                onMisTap: () => {
                  setMisTap(true);
                  if (penMode === "free") resendLive(segs);
                  else onLiveClear?.();
                },
              }
            : undefined
        }
      />
      <div
        className="grow"
        style={{ display: "flex", flexDirection: "column", justifyContent: "flex-end", gap: 12, padding: "16px 20px calc(24px + env(safe-area-inset-bottom))" }}
      >
        {penMode === "free" ? (
          <>
            {inkLimit > 0 && (
              <div style={{ display: "flex", alignItems: "center", gap: 12, border: "3px solid var(--ink)", padding: "13px 15px" }}>
                <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
                  <div className="shout" style={{ fontSize: 14, letterSpacing: "-0.01em" }}>
                    Ink left
                  </div>
                  <div className="meter" style={{ height: 6 }}>
                    <div
                      style={{
                        width: `${Math.max(0, Math.min(100, (inkLeft / budget) * 100))}%`,
                        background: inkLeft / budget < 0.2 ? "var(--amber)" : "var(--red)",
                      }}
                    />
                  </div>
                </div>
                {segs.length > 0 && (
                  <button className="shout u-red" style={{ fontSize: 14 }} onClick={undoSegment}>
                    Undo
                  </button>
                )}
              </div>
            )}
            {inkLimit === 0 && segs.length > 0 && (
              <button
                className="btn btn--outline"
                style={{ padding: 12, fontSize: 14 }}
                onClick={undoSegment}
              >
                Undo last line
              </button>
            )}
            <button
              className={segs.length > 0 ? "btn btn--ink" : "btn btn--disabled"}
              disabled={segs.length === 0}
              onClick={commitNow}
            >
              End turn
            </button>
            <div className="note u-center">
              {misTap
                ? "That looked like a mis-tap — draw a full line."
                : inkLimit > 0
                  ? "Draw as many lines as the ink allows, then end the turn."
                  : "Draw freely, then end the turn."}
            </div>
          </>
        ) : pending ? (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 12, border: "3px solid var(--ink)", padding: "13px 15px" }}>
              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
                <div className="shout" style={{ fontSize: 14, letterSpacing: "-0.01em" }}>
                  Keeping in {Math.ceil(remaining / 1000)}
                </div>
                <div className="meter" style={{ height: 6 }}>
                  <div style={{ width: `${(remaining / GRACE_MS) * 100}%` }} />
                </div>
              </div>
              <button className="shout u-red" style={{ fontSize: 14 }} onClick={undoLine}>
                Undo
              </button>
            </div>
            <button className="btn btn--ink" onClick={commitNow}>
              Commit stroke
            </button>
            <div className="note u-center">
              One unbroken line. Lifting ends the line, not the turn — you get{" "}
              {Math.ceil(GRACE_MS / 1000)}s to undo.
            </div>
          </>
        ) : (
          <div className="note u-center" style={{ paddingBottom: 8 }}>
            {misTap
              ? "That looked like a mis-tap — draw a full line."
              : inkLimit > 0
                ? "Draw one unbroken line — the pen only holds so much ink."
                : "Draw one unbroken line in your colour. Lift to finish it."}
          </div>
        )}
      </div>
    </Screen>
  );
}
