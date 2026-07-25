// A2 Roster — 5 min, 12 max. Colour auto-assigned, reorderable.

import { useRef, useState } from "react";
import { nextFreeColor } from "../../shared/palette";
import { MAX_PLAYERS, MIN_PLAYERS } from "../../shared/types";
import type { Player } from "../../shared/types";
import { Screen, Btn, Swatch, BackLink } from "../components/ui";

export function Roster({
  players,
  onAdd,
  onRemove,
  onReorder,
  onBack,
  onNext,
}: {
  players: Player[];
  onAdd: (name: string, colorIndex: number) => string | null;
  onRemove: (id: string) => void;
  onReorder: (order: string[]) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const add = () => {
    const name = draft.trim();
    if (!name) return;
    const err = onAdd(name, nextFreeColor(players.map((p) => p.colorIndex)));
    if (err) {
      setError(err);
    } else {
      setError(null);
      setDraft("");
      inputRef.current?.focus();
    }
  };

  const move = (id: string, dir: -1 | 1) => {
    const order = players.map((p) => p.id);
    const i = order.indexOf(id);
    const j = i + dir;
    if (j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    onReorder(order);
  };

  return (
    <Screen>
      <div className="header header-row">
        <div>
          <BackLink label="← Back" onClick={onBack} />
          <div className="shout" style={{ fontSize: 28 }}>
            The roster
          </div>
        </div>
        <div className="shout u-red" style={{ fontSize: 22 }}>
          {players.length}/{MAX_PLAYERS}
        </div>
      </div>
      <div className="grow scroll" style={{ padding: "0 20px" }}>
        {players.map((p, i) => (
          <div className="row" key={p.id}>
            <Swatch index={p.colorIndex} />
            <span style={{ flex: 1, fontSize: 16, fontWeight: 600 }}>{p.name}</span>
            <button
              className="small u-muted"
              style={{ padding: "2px 8px", fontSize: 16, opacity: i === 0 ? 0.25 : 1 }}
              onClick={() => move(p.id, -1)}
              aria-label={`Move ${p.name} up`}
            >
              ↑
            </button>
            <button
              className="small u-muted"
              style={{ padding: "2px 8px", fontSize: 16, opacity: i === players.length - 1 ? 0.25 : 1 }}
              onClick={() => move(p.id, 1)}
              aria-label={`Move ${p.name} down`}
            >
              ↓
            </button>
            <button
              style={{ fontSize: 18, color: "var(--muted)", padding: "2px 6px" }}
              onClick={() => onRemove(p.id)}
              aria-label={`Remove ${p.name}`}
            >
              ×
            </button>
          </div>
        ))}
        {players.length < MAX_PLAYERS && (
          <div
            className="row"
            style={{ borderBottom: "2px dashed var(--rule)", padding: "15px 0" }}
          >
            <span style={{ width: 14, height: 14, border: "2px dashed var(--muted)", flex: "none" }} />
            <input
              ref={inputRef}
              style={{ flex: 1, fontSize: 16, fontWeight: 600, minWidth: 0 }}
              placeholder="Add a player"
              value={draft}
              maxLength={18}
              enterKeyHint="done"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") add();
              }}
            />
            <button className="shout u-red" style={{ fontSize: 18, padding: "0 6px" }} onClick={add}>
              +
            </button>
          </div>
        )}
        {error && (
          <div className="small u-red" style={{ paddingTop: 10 }}>
            {error}
          </div>
        )}
        <div className="note" style={{ paddingTop: 14, fontSize: 12 }}>
          Each name takes a stroke colour. Drawing order is shuffled fresh every round; question
          master duty rotates down this list.
        </div>
      </div>
      <div className="footer footer--rule">
        <Btn variant={players.length >= MIN_PLAYERS ? "ink" : "disabled"} onClick={onNext}>
          {players.length >= MIN_PLAYERS
            ? "Choose a deck"
            : `Needs ${MIN_PLAYERS - players.length} more`}
        </Btn>
      </div>
    </Screen>
  );
}
