// D4 Joiner setup — name + colour on one screen. Two taps from link to ready.

import { useState } from "react";
import { SEAT_COLORS, nextFreeColor } from "../../shared/palette";
import type { PublicRoomState } from "../../shared/protocol";
import { deckList } from "../../shared/decks";
import { lengthLabel } from "../lib/labels";
import { Screen, Kicker, Btn } from "../components/ui";
import type { ConnectionState } from "../game/onlineClient";

const CONNECTION_LABELS: Record<ConnectionState, string> = {
  checking: "Checking room…",
  connecting: "Connecting…",
  connected: "Connected",
  reconnecting: "Reconnecting — your name is still here",
  gone: "Room closed",
};

export function JoinerSetup({
  code,
  state,
  connectionState,
  error,
  onJoin,
  onLeave,
}: {
  code: string;
  state: PublicRoomState | null;
  connectionState: ConnectionState;
  error: string | null;
  onJoin: (name: string, colorIndex: number) => void;
  onLeave: () => void;
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
        <span
          style={{
            color:
              connectionState === "connected"
                ? "var(--green)"
                : connectionState === "gone"
                  ? "var(--red)"
                  : "var(--amber)",
          }}
        >
          {CONNECTION_LABELS[connectionState]}
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
        {error && (
          // A full room or a taken name is a dead end without a way out —
          // always offer the exit alongside the complaint.
          <div
            role="alert"
            style={{ border: "3px solid var(--red)", padding: "12px 14px", display: "grid", gap: 8 }}
          >
            <div className="small u-red">{error}</div>
            <button
              className="kicker u-muted"
              style={{ letterSpacing: "0.1em", textAlign: "left" }}
              onClick={onLeave}
            >
              ← Back to the entrance
            </button>
          </div>
        )}
        <div style={{ marginTop: "auto", border: "3px solid var(--ink)", padding: "16px 18px", display: "flex", flexDirection: "column", gap: 8 }}>
          <Kicker style={{ color: "var(--muted)" }}>
            {midGame ? "Round underway" : "Waiting on the host"}
          </Kicker>
          <div className="shout" style={{ fontSize: 22, letterSpacing: "-0.02em" }}>
            {state
              ? `${state.players.length} in the room${deckName ? ` · ${deckName}` : ""} · ${lengthLabel(state.settings)}`
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
        <Btn
          variant={name.trim() && connectionState === "connected" ? "red" : "disabled"}
          onClick={() => onJoin(name, chosen)}
        >
          I'm ready
        </Btn>
      </div>
    </Screen>
  );
}
