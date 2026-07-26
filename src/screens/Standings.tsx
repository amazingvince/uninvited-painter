// C5 Standings — between rounds. Local: shown on the passed phone; online: on
// every device.

import type { ReactNode } from "react";
import { SCORE_TARGET, type Player } from "../../shared/types";
import { Screen, Btn, Swatch } from "../components/ui";

export function Standings({
  players,
  roundsPlayed,
  totalRounds,
  onNext,
  nextLabel,
  waiting,
  banner,
  scoreMode = false,
}: {
  players: Player[];
  roundsPlayed: number;
  totalRounds: number;
  /** "First to 10" rooms have no fixed round count to count towards. */
  scoreMode?: boolean;
  onNext?: () => void;
  nextLabel?: string;
  waiting?: string;
  /** Late-arriving AI results announce themselves here. */
  banner?: ReactNode;
}) {
  const ranked = [...players].sort((a, b) => b.score - a.score);
  const rankFor = (player: Player): number =>
    ranked.findIndex((candidate) => candidate.score === player.score) + 1;
  return (
    <Screen>
      <div className="header header-row">
        <div className="shout standings-title">Standings</div>
        <div className="kicker u-muted standings-progress">
          {scoreMode
            ? `After ${roundsPlayed} · first to ${SCORE_TARGET}`
            : `After ${roundsPlayed} of ${totalRounds}`}
        </div>
      </div>
      <div className="screen-scroll screen-scroll--gutter">
        {ranked.map((p) => {
          const rank = rankFor(p);
          return (
            <div key={p.id} className="score-row score-row--large">
              <span
                className={`shout score-rank ${
                  rank === 1 ? "score-rank--leader" : ""
                }`}
              >
                {rank}
              </span>
              <Swatch index={p.colorIndex} />
              <span className="shout score-player">
                {p.name}
                {rank === 1 && <span className="score-status">Leader</span>}
              </span>
              <span className="shout score-value score-value--large">
                {p.score}
              </span>
            </div>
          );
        })}
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
