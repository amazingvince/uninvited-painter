// C3 Fake artist's guess — only when caught. Free text, fuzzy-matched against
// the word. 30s — guessing right steals the round.

import { useState } from "react";
import { formatClock, useNow } from "../lib/useNow";
import { GUESS_MS, type Stroke } from "../../shared/types";
import { StrokePaths } from "../components/CanvasBoard";
import { Screen, Kicker, Btn } from "../components/ui";

export function Guess({
  category,
  strokes,
  deadline,
  onSubmit,
}: {
  category: string;
  strokes: Stroke[];
  deadline: number | null;
  onSubmit: (text: string) => void;
}) {
  const [text, setText] = useState("");
  const now = useNow(250, deadline !== null);

  return (
    <Screen tone="ink">
      <div className="header--strip kicker" style={{ borderBottom: "3px solid var(--cream)" }}>
        <span>Your guess only</span>
        <span className="u-red">One guess</span>
      </div>
      <div className="grow" style={{ display: "flex", flexDirection: "column", gap: 18, padding: "22px 20px", minHeight: 0, overflowY: "auto" }}>
        <div className="shout" style={{ fontSize: 36, lineHeight: 0.9, letterSpacing: "-0.04em" }}>
          Caught. Now
          <br />
          name the
          <br />
          picture
        </div>
        <div style={{ background: "var(--cream)", height: 140, position: "relative", border: "3px solid var(--cream)", flex: "none" }}>
          <svg viewBox="0 0 1000 1000" preserveAspectRatio="xMidYMid meet" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
            <StrokePaths strokes={strokes} width={20} />
          </svg>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <Kicker style={{ color: "var(--muted-dark)" }}>Category · {category}</Kicker>
          <input
            autoFocus
            value={text}
            maxLength={40}
            enterKeyHint="go"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && text.trim()) onSubmit(text);
            }}
            className="shout"
            style={{
              borderBottom: "3px solid var(--gold)",
              paddingBottom: 10,
              fontSize: 34,
              letterSpacing: "-0.03em",
              color: "var(--gold)",
              width: "100%",
              borderRadius: 0,
              textTransform: "uppercase",
            }}
            placeholder="…"
          />
          <div className="note" style={{ color: "var(--muted-dark)" }}>
            Free text. Fuzzy-matched against the word — plurals and a letter's slip are forgiven.
          </div>
        </div>
        <div style={{ marginTop: "auto" }} className="btn-stack">
          <Btn variant="red" onClick={() => text.trim() && onSubmit(text)}>
            Say it out loud, then submit
          </Btn>
          <div className="small u-center" style={{ color: "var(--muted-dark)" }}>
            {formatClock(deadline === null ? GUESS_MS : deadline - now)} · guessing right steals
            the round
          </div>
        </div>
      </div>
    </Screen>
  );
}

export function GuessWait({
  fakeName,
  deadline,
}: {
  fakeName: string;
  deadline: number | null;
}) {
  const now = useNow(250, deadline !== null);
  return (
    <Screen tone="ink">
      <div className="header--strip kicker" style={{ borderBottom: "3px solid var(--cream)" }}>
        <span>Caught</span>
        <span className="u-red">One guess</span>
      </div>
      <div className="grow" style={{ display: "flex", flexDirection: "column", justifyContent: "center", gap: 18, padding: "0 22px" }}>
        <div className="shout" style={{ fontSize: 40, lineHeight: 0.88, letterSpacing: "-0.04em" }}>
          {fakeName} is
          <br />
          naming the
          <br />
          picture
        </div>
        <div className="body-copy" style={{ color: "var(--muted-dark)" }}>
          One guess at the word steals the round back. Keep your faces still.
        </div>
        {deadline !== null && (
          <div className="shout u-gold" style={{ fontSize: 64 }}>
            {formatClock(deadline - now)}
          </div>
        )}
      </div>
    </Screen>
  );
}
