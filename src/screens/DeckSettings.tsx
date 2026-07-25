// A3 Deck + rules — one deck or shuffled. QM rotates each round or can be
// switched off.

import { deckList } from "../../shared/decks";
import type { DeckId, QmMode, Settings } from "../../shared/types";
import { Screen, Btn, BackLink } from "../components/ui";

export function DeckSettings({
  settings,
  onChange,
  onBack,
  onStart,
  startLabel = "Open the round",
}: {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  onBack: () => void;
  onStart: () => void;
  startLabel?: string;
}) {
  const decks = deckList();
  const pick = (deckId: DeckId) => onChange({ deckId });

  return (
    <Screen>
      <div className="header">
        <BackLink label="← Roster" onClick={onBack} />
        <div className="shout" style={{ fontSize: 28 }}>
          The collection
        </div>
      </div>
      <div className="grow scroll" style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 10 }}>
        {decks.map((deck) => {
          const on = settings.deckId === deck.id;
          return (
            <button
              key={deck.id}
              className={on ? "deck-card deck-card--on" : "deck-card"}
              onClick={() => pick(deck.id)}
            >
              <div>
                <div className="shout" style={{ fontSize: 20, letterSpacing: "-0.02em" }}>
                  {deck.name}
                </div>
                <div className="small" style={{ color: on ? "inherit" : "var(--muted)" }}>
                  {deck.words.length} words{deck.blurb ? ` · ${deck.blurb}` : ""}
                </div>
              </div>
              {on && (
                <span className="shout" style={{ fontSize: 20 }}>
                  ✓
                </span>
              )}
            </button>
          );
        })}
        <button
          className={
            settings.deckId === "everything" ? "deck-card deck-card--on" : "deck-card deck-card--dashed"
          }
          onClick={() => pick("everything")}
        >
          <div>
            <div className="shout" style={{ fontSize: 20, letterSpacing: "-0.02em" }}>
              Everything
            </div>
            <div className="small">Shuffle all four</div>
          </div>
          {settings.deckId === "everything" && (
            <span className="shout" style={{ fontSize: 20 }}>
              ✓
            </span>
          )}
        </button>

        <div
          className="hairline-top"
          style={{ marginTop: "auto", paddingTop: 14, display: "flex", justifyContent: "space-between", alignItems: "center" }}
        >
          <span className="kicker" style={{ fontSize: 13, letterSpacing: "0.08em" }}>
            Rounds
          </span>
          <div className="seg">
            {[3, 5, 7].map((n) => (
              <button key={n} className={settings.rounds === n ? "on" : ""} onClick={() => onChange({ rounds: n })}>
                {n}
              </button>
            ))}
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span className="kicker" style={{ fontSize: 13, letterSpacing: "0.08em" }}>
            Question master
          </span>
          <div className="seg" style={{ fontSize: 13 }}>
            {(["rotate", "off"] as QmMode[]).map((mode) => (
              <button
                key={mode}
                className={settings.qmMode === mode ? "on" : ""}
                style={{ fontSize: 13 }}
                onClick={() => onChange({ qmMode: mode })}
              >
                {mode === "rotate" ? "Rotate" : "Off"}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="footer footer--rule">
        <Btn variant="red" onClick={onStart}>
          {startLabel}
        </Btn>
      </div>
    </Screen>
  );
}
