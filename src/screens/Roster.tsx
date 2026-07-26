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
          <div className="shout compact-screen-title">The roster</div>
        </div>
        <div className="shout u-red compact-screen-count">
          {players.length}/{MAX_PLAYERS}
        </div>
      </div>
      <div className="screen-scroll screen-scroll--gutter">
        {players.map((p, i) => (
          <div className="row roster-row" key={p.id}>
            <Swatch index={p.colorIndex} />
            <span className="roster-player-name">{p.name}</span>
            <button
              className="tap-target roster-action"
              disabled={i === 0}
              onClick={() => move(p.id, -1)}
              aria-label={`Move ${p.name} up`}
            >
              ↑
            </button>
            <button
              className="tap-target roster-action"
              disabled={i === players.length - 1}
              onClick={() => move(p.id, 1)}
              aria-label={`Move ${p.name} down`}
            >
              ↓
            </button>
            <button
              className="tap-target roster-action roster-action--remove"
              onClick={() => onRemove(p.id)}
              aria-label={`Remove ${p.name}`}
            >
              ×
            </button>
          </div>
        ))}
        {players.length < MAX_PLAYERS && (
          <div className="row roster-add-row">
            <span className="roster-add-marker" />
            <input
              ref={inputRef}
              className="roster-input"
              placeholder="Add a player"
              value={draft}
              maxLength={18}
              enterKeyHint="done"
              aria-describedby={error ? "roster-error" : undefined}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") add();
              }}
            />
            <button
              className="shout u-red tap-target roster-add-action"
              onClick={add}
              aria-label="Add player"
            >
              +
            </button>
          </div>
        )}
        {error && (
          <div id="roster-error" className="small u-red roster-error">
            {error}
          </div>
        )}
        <div className="note roster-note">
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
