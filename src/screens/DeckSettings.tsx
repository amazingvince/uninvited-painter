// A3 Deck + rules — one deck or shuffled. QM rotates each round or can be
// switched off.

import { deckList } from "../../shared/decks";
import { HOUSE_MIN_WORDS, type DeckId, type Settings } from "../../shared/types";
import { AiSettings } from "../components/AiSettings";
import { SettingSelect } from "../components/SettingSelect";
import { Screen, Btn, BackLink } from "../components/ui";
import {
  SETTING_OPTIONS,
  advancedSettingsSummary,
} from "../lib/settingsOptions";

export function DeckSettings({
  settings,
  houseWordCount,
  onHouseWords,
  onChange,
  onBack,
  onStart,
  startLabel = "Open the round",
}: {
  settings: Settings;
  houseWordCount: number;
  onHouseWords: () => void;
  onChange: (patch: Partial<Settings>) => void;
  onBack: () => void;
  onStart: () => void;
  startLabel?: string;
}) {
  const decks = deckList();
  const pick = (deckId: DeckId) => onChange({ deckId });
  const houseWordsNeeded =
    settings.deckId === "house"
      ? Math.max(0, HOUSE_MIN_WORDS - houseWordCount)
      : 0;

  return (
    <Screen>
      <div className="header">
        <BackLink label="← Roster" onClick={onBack} />
        <div className="shout" style={{ fontSize: 28 }}>
          The collection
        </div>
      </div>
      <div className="screen-scroll" style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 10 }}>
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
        <button
          className={settings.deckId === "house" ? "deck-card deck-card--on" : "deck-card deck-card--dashed"}
          onClick={() => {
            pick("house");
            onHouseWords();
          }}
        >
          <div>
            <div className="shout" style={{ fontSize: 20, letterSpacing: "-0.02em" }}>
              House deck
            </div>
            <div className="small">
              {houseWordCount > 0
                ? `${houseWordCount} of your own words${houseWordCount < HOUSE_MIN_WORDS ? ` · needs ${HOUSE_MIN_WORDS - houseWordCount} more` : ""}`
                : "Write your own words"}
            </div>
          </div>
          {settings.deckId === "house" && (
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
            Length
          </span>
          <div className="seg">
            {[3, 5, 7].map((n) => (
              <button
                key={n}
                className={settings.winMode === "rounds" && settings.rounds === n ? "on" : ""}
                onClick={() => onChange({ rounds: n, winMode: "rounds" })}
              >
                {n}
              </button>
            ))}
            <button
              className={settings.winMode === "score10" ? "on" : ""}
              style={{ fontSize: 12 }}
              onClick={() => onChange({ winMode: "score10" })}
            >
              To 10
            </button>
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span className="kicker" style={{ fontSize: 13, letterSpacing: "0.08em" }}>
            Passes
          </span>
          <div className="seg">
            {SETTING_OPTIONS.passes.map(({ value, label }) => (
              <button key={value} className={settings.passes === value ? "on" : ""} onClick={() => onChange({ passes: value })}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <details className="settings-disclosure">
          <summary>
            <span className="shout">Advanced rules</span>
            <span className="small u-muted">
              {advancedSettingsSummary(settings, "local")}
            </span>
          </summary>
          <div className="settings-disclosure__body">
            <SettingSelect
              label="Pen"
              value={settings.penMode}
              options={SETTING_OPTIONS.pen}
              onChange={(penMode) => onChange({ penMode })}
            />
            <SettingSelect
              label="Ink per turn"
              value={settings.inkLimit}
              options={SETTING_OPTIONS.ink}
              onChange={(inkLimit) => onChange({ inkLimit })}
            />
            <SettingSelect
              label="Question master"
              value={settings.qmMode}
              options={SETTING_OPTIONS.qm}
              onChange={(qmMode) => onChange({ qmMode })}
            />
            {settings.qmMode === "off" && (
              <div className="note" style={{ fontSize: 12 }}>
                Auto word: the app draws the word itself, so everyone — host
                included — plays as an artist.
              </div>
            )}
            <AiSettings settings={settings} onChange={onChange} />
          </div>
        </details>
      </div>
      <div className="action-footer">
        <Btn
          variant={houseWordsNeeded > 0 ? "disabled" : "red"}
          disabled={houseWordsNeeded > 0}
          onClick={onStart}
        >
          {houseWordsNeeded > 0
            ? `House deck needs ${houseWordsNeeded} more`
            : startLabel}
        </Btn>
      </div>
    </Screen>
  );
}
