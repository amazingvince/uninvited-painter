// C5 Standings — between rounds. Local: shown on the passed phone; online: on
// every device.

import type { ReactNode } from "react";
import type { Player } from "../../shared/types";
import { Screen, Btn, Swatch } from "../components/ui";

export function Standings({
  players,
  roundsPlayed,
  totalRounds,
  onNext,
  nextLabel,
  waiting,
  banner,
}: {
  players: Player[];
  roundsPlayed: number;
  totalRounds: number;
  onNext?: () => void;
  nextLabel?: string;
  waiting?: string;
  /** Late-arriving AI results announce themselves here. */
  banner?: ReactNode;
}) {
  const ranked = [...players].sort((a, b) => b.score - a.score);
  return (
    <Screen>
      <div className="header header-row">
        <div className="shout" style={{ fontSize: 30, letterSpacing: "-0.035em" }}>
          Standings
        </div>
        <div className="kicker u-muted" style={{ letterSpacing: "0.14em" }}>
          After {roundsPlayed} of {totalRounds}
        </div>
      </div>
      <div className="grow scroll" style={{ padding: "0 20px" }}>
        {ranked.map((p, i) => (
          <div key={p.id} className="row" style={{ padding: "16px 0" }}>
            <span className="shout" style={{ fontSize: 18, color: i === 0 ? "var(--red)" : "var(--muted)", width: 26 }}>
              {i + 1}
            </span>
            <Swatch index={p.colorIndex} />
            <span className="shout" style={{ flex: 1, fontSize: 19, letterSpacing: "-0.02em" }}>
              {p.name}
            </span>
            <span className="shout" style={{ fontSize: 26 }}>
              {p.score}
            </span>
          </div>
        ))}
        <div className="note" style={{ paddingTop: 14, fontSize: 12 }}>
          Fake artist duty rotates so nobody plays it twice before everyone has.
        </div>
      </div>
      <div className="footer footer--rule btn-stack">
        {banner}
        {onNext ? (
          <Btn variant="ink" onClick={onNext}>
            {nextLabel ?? `Round ${roundsPlayed + 1}`}
          </Btn>
        ) : (
          <div className="note u-center pulse">{waiting ?? "Waiting for the host…"}</div>
        )}
      </div>
    </Screen>
  );
}
