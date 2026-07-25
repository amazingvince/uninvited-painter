// B5 Your turn — one unbroken line. Lifting ends the line, not the turn:
// the dashed stroke sits in a 4s grace window (undo restores a blank canvas
// turn, timer restarts), then commits.

import { useEffect, useRef, useState } from "react";
import { GRACE_MS } from "../../shared/types";
import type { Stroke, StrokePoints } from "../../shared/types";
import { CanvasBoard } from "../components/CanvasBoard";
import { Screen, Swatch } from "../components/ui";

export function DrawTurn({
  word,
  category,
  colorIndex,
  strokes,
  strokeNo,
  strokeTotal,
  youLabel = "You",
  paused = false,
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
  onLive?: (batch: StrokePoints) => void;
  onLiveClear?: () => void;
  onCommit: (points: StrokePoints) => void;
}) {
  const [pending, setPending] = useState<StrokePoints | null>(null);
  const [misTap, setMisTap] = useState(false);
  const [deadline, setDeadline] = useState<number | null>(null);
  const [remaining, setRemaining] = useState(GRACE_MS);
  const pendingRef = useRef<StrokePoints | null>(null);
  const frozenRemaining = useRef<number | null>(null);

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

  const penUp = (points: StrokePoints) => {
    pendingRef.current = points;
    setPending(points);
    setMisTap(false);
    setRemaining(GRACE_MS);
    setDeadline(Date.now() + GRACE_MS);
  };

  const undo = () => {
    pendingRef.current = null;
    setPending(null);
    setDeadline(null);
    onLiveClear?.();
  };

  const commitNow = () => {
    const pts = pendingRef.current;
    if (!pts) return;
    pendingRef.current = null;
    setPending(null);
    setDeadline(null);
    onCommit(pts);
  };

  const header = (
    <div className="header header-row">
      <div style={{ minWidth: 0 }}>
        <div className="kicker u-muted">Your stroke</div>
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
        pending={pending ? { colorIndex, points: pending } : null}
        corner={`${String(strokeNo).padStart(2, "0")} / ${strokeTotal}`}
        drawing={
          pending
            ? undefined
            : {
                colorIndex,
                onLive,
                onPenUp: penUp,
                disabled: paused,
                onMisTap: () => {
                  setMisTap(true);
                  onLiveClear?.(); // spectators drop the phantom dot
                },
              }
        }
      />
      <div
        className="grow"
        style={{ display: "flex", flexDirection: "column", justifyContent: "flex-end", gap: 12, padding: "16px 20px calc(24px + env(safe-area-inset-bottom))" }}
      >
        {pending ? (
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
              <button className="shout u-red" style={{ fontSize: 14 }} onClick={undo}>
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
              : "Draw one unbroken line in your colour. Lift to finish it."}
          </div>
        )}
      </div>
    </Screen>
  );
}
