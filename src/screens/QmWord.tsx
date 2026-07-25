// A4 Question master — the only ink-flood screen in setup. Dark = private.

import type { ReactNode } from "react";
import { Screen, Kicker, Btn } from "../components/ui";

export function QmWord({
  qmName,
  roundNo,
  totalRounds,
  category,
  word,
  artists,
  onRedraw,
  onDeal,
}: {
  qmName: string;
  roundNo: number;
  totalRounds: number;
  category: string;
  word: string;
  artists: number;
  onRedraw: () => void;
  onDeal: () => void;
}) {
  const sub: ReactNode = (
    <>
      {numberWord(artists)} artists, one of them fake. Nobody knows who.
    </>
  );
  return (
    <Screen tone="ink">
      <div className="header--strip kicker" style={{ borderBottom: "3px solid var(--cream)" }}>
        <span>
          Round {roundNo} / {totalRounds}
        </span>
        <span className="u-red">Question master</span>
      </div>
      <div
        className="grow"
        style={{ display: "flex", flexDirection: "column", justifyContent: "center", gap: 20, padding: "0 22px" }}
      >
        <div className="shout" style={{ fontSize: 40, lineHeight: 0.88, letterSpacing: "-0.04em" }}>
          {qmName},
          <br />
          you set
          <br />
          the word
        </div>
        <div className="slab">
          <Kicker style={{ color: "var(--muted-dark)" }}>Drawn from {category}</Kicker>
          <div
            className="shout u-gold"
            style={{
              fontSize:
                word.length > 12 ? "clamp(24px, 9vw, 34px)" : "clamp(32px, 14vw, 52px)",
              letterSpacing: "-0.04em",
              overflowWrap: "anywhere",
            }}
          >
            {word}
          </div>
          <button
            className="kicker"
            style={{ letterSpacing: "0.1em", color: "var(--muted-dark)", paddingTop: 8, fontSize: 13 }}
            onClick={onRedraw}
          >
            ↺ Draw another word
          </button>
        </div>
        <div className="body-copy">
          Say the category out loud, not the word. You don't draw. You score with the fake artist if
          they get away with it — so keep your face still.
        </div>
      </div>
      <div className="footer btn-stack">
        <Btn variant="red" onClick={onDeal}>
          Deal the cards
        </Btn>
        <div className="small u-center" style={{ color: "var(--muted-dark)" }}>
          {sub}
        </div>
      </div>
    </Screen>
  );
}

function numberWord(n: number): string {
  const words = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve"];
  return words[n] ?? String(n);
}
