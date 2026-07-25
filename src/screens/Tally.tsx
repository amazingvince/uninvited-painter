// C2 Tally — bars animate up from zero. Online: appears on all devices at once.

import { useEffect, useState } from "react";
import type { Player } from "../../shared/types";
import { Screen, Btn } from "../components/ui";

export function Tally({
  votes,
  players,
  accusedId,
  fakeWasAccused,
  buttonLabel,
  onContinue,
  waiting,
}: {
  votes: Record<string, string>;
  players: Player[];
  accusedId: string | null;
  fakeWasAccused: boolean;
  buttonLabel?: string;
  onContinue?: () => void;
  waiting?: string;
}) {
  const [grown, setGrown] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setGrown(true), 60);
    return () => clearTimeout(id);
  }, []);

  const tally: Record<string, number> = {};
  for (const target of Object.values(votes)) tally[target] = (tally[target] ?? 0) + 1;
  const ranked = Object.entries(tally).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...ranked.map(([, n]) => n));
  const accused = accusedId ? players.find((p) => p.id === accusedId) : null;

  return (
    <Screen>
      <div className="header">
        <div className="kicker u-muted">Ballots in</div>
        <div className="shout" style={{ fontSize: 38, lineHeight: 0.9 }}>
          The count
        </div>
      </div>
      <div className="grow scroll" style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
        {ranked.map(([id, count], i) => {
          const player = players.find((p) => p.id === id);
          const top = i === 0 && count === max && accusedId === id;
          return (
            <div key={id} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <span className="shout" style={{ fontSize: 20, letterSpacing: "-0.02em", color: top ? "inherit" : "var(--muted)" }}>
                  {player?.name ?? "?"}
                </span>
                <span className="shout" style={{ fontSize: 20, color: top ? "var(--red)" : "var(--muted)" }}>
                  {count}
                </span>
              </div>
              <div className="tallybar">
                <div
                  style={{
                    width: grown ? `${(count / max) * 100}%` : "0%",
                    background: top ? "var(--red)" : "var(--ink)",
                  }}
                />
              </div>
            </div>
          );
        })}
        <div style={{ marginTop: "auto", border: "3px solid var(--ink)", padding: 18, display: "flex", flexDirection: "column", gap: 8 }}>
          <div className="shout" style={{ fontSize: 24, letterSpacing: "-0.03em" }}>
            {accused ? `${accused.name} is accused` : "The room is split"}
          </div>
          <div className="body-copy" style={{ fontSize: 14 }}>
            {accused
              ? fakeWasAccused
                ? "A tie would have acquitted the room and handed the round to the fake artist. Not today."
                : "The room settled on a name. Whether it's the right one is another matter."
              : "A tie acquits — the round goes to the fake artist."}
          </div>
        </div>
      </div>
      <div className="footer footer--rule">
        {onContinue ? (
          <Btn variant="red" onClick={onContinue}>
            {buttonLabel ?? "Continue"}
          </Btn>
        ) : (
          <div className="note u-center pulse">{waiting ?? "Waiting…"}</div>
        )}
      </div>
    </Screen>
  );
}
