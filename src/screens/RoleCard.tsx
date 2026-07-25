// B2 Artist card (ink flood) and B3 Fake artist card (red flood). Identical
// layout so a glance from across the table tells nothing.

import { SEAT_COLORS } from "../../shared/palette";
import { Screen, Kicker } from "../components/ui";

export function RoleCard({
  fake,
  playerName,
  category,
  word,
  colorIndex,
}: {
  fake: boolean;
  playerName: string;
  category: string;
  word: string | null;
  colorIndex: number;
}) {
  const dim = fake ? "var(--muted-on-red)" : "var(--muted-dark)";
  return (
    <Screen tone={fake ? "red" : "ink"}>
      <div
        className="header--strip kicker"
        style={{ borderBottom: `3px solid currentColor` }}
      >
        <span>{playerName} only</span>
        <span>{category}</span>
      </div>
      <div
        className="grow"
        style={{ display: "flex", flexDirection: "column", justifyContent: "center", gap: 22, padding: "0 22px" }}
      >
        <div className="shout" style={{ fontSize: 40, lineHeight: 0.88, letterSpacing: "-0.04em" }}>
          {fake ? (
            <>
              You're the
              <br />
              fake artist
            </>
          ) : (
            <>
              You're a<br />
              real artist
            </>
          )}
        </div>
        <div className="slab">
          <Kicker style={{ color: dim }}>The word</Kicker>
          <div
            className="shout"
            style={{
              // Clamped so long words survive narrow fold cover screens.
              fontSize:
                word && word.length > 12
                  ? "clamp(26px, 10vw, 38px)"
                  : "clamp(34px, 15vw, 56px)",
              lineHeight: 0.9,
              letterSpacing: "-0.045em",
              color: fake ? "var(--red-deep)" : "var(--gold)",
              overflowWrap: "anywhere",
            }}
          >
            {fake ? "???" : word}
          </div>
        </div>
        <div className="body-copy" style={{ fontSize: 16 }}>
          {fake
            ? "No word. Draw like you know exactly what this is. Caught? You get one guess to steal the round."
            : "Prove you know it — but not so clearly that the fake artist can read the picture and steal the word."}
        </div>
        <div
          className="kicker"
          style={{ display: "flex", alignItems: "center", gap: 10, letterSpacing: "0.08em", color: dim }}
        >
          <span
            style={{
              width: 14,
              height: 14,
              background: SEAT_COLORS[colorIndex],
              display: "block",
              boxShadow: fake ? "0 0 0 2px var(--cream-on-red)" : "none",
            }}
          />
          Your colour
        </div>
      </div>
      <div
        className="u-center kicker"
        style={{
          borderTop: "3px solid currentColor",
          padding: "18px 20px calc(28px + env(safe-area-inset-bottom))",
          letterSpacing: "0.14em",
          color: dim,
        }}
      >
        Release to hide
      </div>
    </Screen>
  );
}
