// The house deck editor — players write their own words. Online, each player
// only ever sees their own submissions; the pot size is public.

import { useState } from "react";
import { HOUSE_MIN_WORDS, HOUSE_WORD_MAX_LEN } from "../../shared/types";
import { Screen, Btn, Kicker, BackLink } from "../components/ui";

export function HouseWords({
  ownWords,
  totalCount,
  note,
  onAdd,
  onRemove,
  onBack,
}: {
  ownWords: string[];
  totalCount: number;
  note: string;
  onAdd: (words: string[]) => void;
  onRemove: (word: string) => void;
  onBack: () => void;
}) {
  const [draft, setDraft] = useState("");

  const add = () => {
    const words = draft
      .split(/[,\n]/)
      .map((w) => w.trim())
      .filter((w) => w.length >= 2);
    if (words.length > 0) onAdd(words);
    setDraft("");
  };

  return (
    <Screen>
      <div className="header header-row">
        <div>
          <BackLink label="← Back" onClick={onBack} />
          <div className="shout" style={{ fontSize: 28 }}>
            House deck
          </div>
        </div>
        <div className="shout" style={{ fontSize: 22, color: totalCount >= HOUSE_MIN_WORDS ? "var(--green)" : "var(--red)" }}>
          {totalCount}
        </div>
      </div>
      <div className="grow scroll" style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <input
            style={{ flex: 1, fontSize: 16, fontWeight: 600, borderBottom: "3px solid var(--ink)", paddingBottom: 6, minWidth: 0 }}
            placeholder="Write a word, press enter"
            value={draft}
            maxLength={HOUSE_WORD_MAX_LEN * 4}
            enterKeyHint="done"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") add();
            }}
          />
          <button className="shout u-red" style={{ fontSize: 20, padding: "0 6px" }} onClick={add}>
            +
          </button>
        </div>
        <div className="note" style={{ fontSize: 12 }}>
          Commas add several at once. Concrete, drawable things work best — the room needs{" "}
          {HOUSE_MIN_WORDS} words before the deck opens.
        </div>
        {ownWords.length > 0 && (
          <>
            <Kicker style={{ color: "var(--muted)", paddingTop: 6 }}>Your words</Kicker>
            <div className="chips">
              {ownWords.map((word) => (
                <button key={word} className="chip" onClick={() => onRemove(word)}>
                  {word} ×
                </button>
              ))}
            </div>
          </>
        )}
        <div className="note" style={{ marginTop: "auto", borderTop: "1px solid var(--rule)", paddingTop: 12 }}>
          {note}
        </div>
      </div>
      <div className="footer footer--rule">
        <Btn variant="ink" onClick={onBack}>
          Done
        </Btn>
      </div>
    </Screen>
  );
}
