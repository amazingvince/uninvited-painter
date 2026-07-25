// D4 Joiner setup — name + colour on one screen. Two taps from link to ready.

import { useState } from "react";
import { SEAT_COLORS, nextFreeColor } from "../../shared/palette";
import type { PublicRoomState } from "../../shared/protocol";
import { deckList } from "../../shared/decks";
import { Screen, Kicker, Btn } from "../components/ui";

export function JoinerSetup({
  code,
  state,
  connected,
  error,
  onJoin,
}: {
  code: string;
  state: PublicRoomState | null;
  connected: boolean;
  error: string | null;
  onJoin: (name: string, colorIndex: number) => void;
}) {
  const taken = (state?.players ?? []).map((p) => p.colorIndex);
  const [name, setName] = useState("");
  const [color, setColor] = useState<number | null>(null);
  const chosen = color !== null && !taken.includes(color) ? color : nextFreeColor(taken);
  const host = state?.players.find((p) => p.id === state.hostId);
  const deckName =
    state?.settings.deckId === "everything"
      ? "Everything"
      : state?.settings.deckId === "house"
        ? "House deck"
        : (deckList().find((d) => d.id === state?.settings.deckId)?.name ?? "");
  const midGame = state !== null && state.phase !== "lobby";

  return (
    <Screen>
      <div className="header--strip kicker" style={{ borderBottom: "3px solid var(--ink)" }}>
        <span>Room {code}</span>
        <span style={{ color: connected ? "var(--green)" : "var(--amber)" }}>
          {connected ? "Connected" : "Connecting…"}
        </span>
      </div>
      <div className="grow scroll" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 18 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <Kicker style={{ color: "var(--muted)" }}>Sign the register</Kicker>
          <input
            className="register"
            value={name}
            maxLength={18}
            placeholder="Your name"
            enterKeyHint="done"
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <Kicker style={{ color: "var(--muted)", paddingBottom: 4 }}>Your stroke colour</Kicker>
          <div className="swatch-grid">
            {SEAT_COLORS.map((hex, i) => {
              const isTaken = taken.includes(i);
              return (
                <button
                  key={hex}
                  className={`swatch-pick${chosen === i ? " swatch-pick--on" : ""}${isTaken ? " swatch-pick--taken" : ""}`}
                  style={{ background: hex }}
                  onClick={() => !isTaken && setColor(i)}
                  aria-label={`Colour ${i + 1}`}
                />
              );
            })}
          </div>
          <div className="note" style={{ fontSize: 12, paddingTop: 4 }}>
            Faded colours are taken. Colour is how the room reads your lines — pick one you'll
            recognise.
          </div>
        </div>
        {error && <div className="small u-red">{error}</div>}
        <div style={{ marginTop: "auto", border: "3px solid var(--ink)", padding: "16px 18px", display: "flex", flexDirection: "column", gap: 8 }}>
          <Kicker style={{ color: "var(--muted)" }}>
            {midGame ? "Round underway" : "Waiting on the host"}
          </Kicker>
          <div className="shout" style={{ fontSize: 22, letterSpacing: "-0.02em" }}>
            {state
              ? `${state.players.length} in the room${deckName ? ` · ${deckName}` : ""} · ${state.settings.rounds} rounds`
              : "…"}
          </div>
          <div className="note" style={{ fontSize: 13, color: "inherit", fontWeight: 600 }}>
            {midGame
              ? "You'll be dealt in when the next round opens. Keep this tab open."
              : `${host ? `${host.name} opens the round.` : ""} Keep this tab open — nothing to install.`}
          </div>
        </div>
      </div>
      <div className="footer footer--rule">
        <Btn variant={name.trim() && connected ? "red" : "disabled"} onClick={() => onJoin(name, chosen)}>
          I'm ready
        </Btn>
      </div>
    </Screen>
  );
}
