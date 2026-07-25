// C1 Vote — you can't vote for yourself; the QM doesn't vote. Votes stay
// hidden until everyone has locked in.

import { useState } from "react";
import { SEAT_COLORS } from "../../shared/palette";
import type { Player, Stroke } from "../../shared/types";
import { StrokePaths } from "../components/CanvasBoard";
import { Screen, Btn, Swatch } from "../components/ui";

export function Vote({
  voterId,
  voterName,
  candidates,
  qmId,
  players,
  strokes,
  votersIn,
  onLock,
}: {
  voterId: string;
  voterName?: string;
  candidates: string[]; // active artists
  qmId: string | null;
  players: Player[];
  strokes: Stroke[];
  votersIn: string[];
  onLock: (targetId: string) => void;
}) {
  const [choice, setChoice] = useState<string | null>(null);
  const [zoom, setZoom] = useState(false);
  const rows = [...(qmId ? [qmId] : []), ...candidates];

  return (
    <Screen>
      <div className="header">
        <div className="kicker u-red">Both passes complete</div>
        <div className="shout" style={{ fontSize: 38, lineHeight: 0.9 }}>
          Name the fraud
        </div>
        {voterName && (
          <div className="small u-muted" style={{ paddingTop: 4 }}>
            {voterName}'s secret ballot · {votersIn.length} in
          </div>
        )}
      </div>
      <button
        style={{
          margin: "14px 20px",
          background: "var(--paper)",
          border: "2px solid var(--ink)",
          height: zoom ? "auto" : 138,
          aspectRatio: zoom ? "1" : undefined,
          position: "relative",
          flex: "none",
          transition: "height .2s",
        }}
        onClick={() => setZoom(!zoom)}
      >
        <svg viewBox="0 0 1000 1000" preserveAspectRatio="xMidYMid meet" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
          <StrokePaths strokes={strokes} width={20} highlight={choice} />
        </svg>
        {choice && (
          <span className="kicker" style={{ position: "absolute", bottom: 6, left: 8, color: "var(--red)", letterSpacing: "0.1em" }}>
            {players.find((p) => p.id === choice)?.name}'s lines
          </span>
        )}
        <span className="kicker" style={{ position: "absolute", bottom: 6, right: 8, color: "var(--muted)", letterSpacing: "0.1em" }}>
          {zoom ? "Tap to shrink" : "Tap to enlarge"}
        </span>
      </button>
      <div className="grow scroll" style={{ padding: "0 20px" }}>
        {rows.map((id) => {
          const player = players.find((p) => p.id === id);
          if (!player) return null;
          const isQm = id === qmId;
          const isSelf = id === voterId;
          const selected = choice === id;
          const disabled = isQm || isSelf;
          return (
            <button
              key={id}
              disabled={disabled}
              onClick={() => setChoice(id)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                width: selected ? "calc(100% + 24px)" : "100%",
                margin: selected ? "0 -12px" : 0,
                padding: selected ? "14px 12px" : "14px 0",
                borderTop: selected ? "none" : "1px solid var(--rule)",
                background: selected ? "var(--red)" : "none",
                color: selected ? "var(--cream-on-red)" : disabled && !isQm ? "var(--muted)" : "inherit",
                opacity: isSelf ? 0.5 : 1,
              }}
            >
              <span
                className="swatch"
                style={{
                  background: selected ? "var(--cream-on-red)" : undefined,
                }}
              >
                {!selected && <Swatch index={player.colorIndex} />}
              </span>
              <span
                className="shout"
                style={{
                  flex: 1,
                  fontSize: 17,
                  letterSpacing: "-0.02em",
                  textAlign: "left",
                  // Names wear their stroke colour so the ballot reads like the wall.
                  color: selected ? "inherit" : SEAT_COLORS[player.colorIndex],
                }}
              >
                {player.name}
              </span>
              <span className="kicker" style={{ letterSpacing: "0.1em", color: selected ? "inherit" : "var(--muted)" }}>
                {isQm ? "QM" : isSelf ? "You" : selected ? "Your vote" : ""}
              </span>
            </button>
          );
        })}
      </div>
      <div className="footer btn-stack">
        <Btn variant={choice ? "ink" : "disabled"} onClick={() => choice && onLock(choice)}>
          {choice ? `Lock in ${players.find((p) => p.id === choice)?.name}` : "Pick a painter"}
        </Btn>
        <div className="note u-center">Votes stay hidden until everyone has locked in</div>
      </div>
    </Screen>
  );
}
