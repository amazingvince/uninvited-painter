// D6 Disconnect — the case everyone forgets. Seats are held 30s; voiding on
// fake-artist drop keeps it fair.

import { useNow, formatClock } from "../lib/useNow";
import { HOLD_MS } from "../../shared/types";
import type { PublicRoomState } from "../../shared/protocol";
import { Screen, Kicker, Btn } from "../components/ui";

export function DisconnectOverlay({
  state,
  isHost,
  onDrop,
}: {
  state: PublicRoomState;
  isHost: boolean;
  onDrop: (playerId: string) => void;
}) {
  const now = useNow(250);
  const holds = Object.entries(state.holds);
  if (holds.length === 0) return null;
  const [firstId, firstDeadline] = holds[0];
  const held = state.players.find((p) => p.id === firstId);
  const additionalHolds = holds.length - 1;
  const remaining = Math.max(0, firstDeadline - now);
  const pct = Math.min(100, Math.max(0, (remaining / HOLD_MS) * 100));

  return (
    <div className="overlay">
      <Screen>
        <div
          className="kicker"
          style={{ background: "var(--ink)", color: "var(--cream)", padding: "16px 20px", display: "flex", justifyContent: "space-between" }}
        >
          <span>{state.code} · paused</span>
          <span className="u-gold pulse">Holding a seat</span>
        </div>
        <div className="grow scroll" style={{ padding: "22px 20px", display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div className="shout" style={{ fontSize: 40, lineHeight: 0.9, letterSpacing: "-0.04em" }}>
              {held?.name ?? "Someone"} left
              <br />
              the room
            </div>
            {additionalHolds > 0 && (
              <Kicker style={{ color: "var(--amber)" }}>
                and {additionalHolds} more seats held
              </Kicker>
            )}
            <div className="body-copy">
              Their seat is held for {Math.round(HOLD_MS / 1000)} seconds. If they don't come back,
              the round continues without their stroke — and their vote is dropped from the count.
            </div>
          </div>
          <div style={{ border: "3px solid var(--ink)", padding: "16px 18px", display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <span className="shout" style={{ fontSize: 20, letterSpacing: "-0.02em" }}>
                Holding the seat
              </span>
              <span className="shout u-red" style={{ fontSize: 20 }}>
                {formatClock(remaining)}
              </span>
            </div>
            <div className="meter">
              <div style={{ width: `${pct}%` }} />
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <Kicker style={{ color: "var(--muted)" }}>Presence</Kicker>
            {state.players.map((p) => {
              const heldSeat = state.holds[p.id] !== undefined;
              const dropped = state.round?.droppedIds.includes(p.id);
              return (
                <div
                  key={p.id}
                  style={{ display: "flex", justifyContent: "space-between", padding: "11px 0", borderBottom: "1px solid var(--rule)", fontSize: 15, fontWeight: 600, color: dropped ? "var(--muted)" : "inherit" }}
                >
                  <span>{p.name}</span>
                  {dropped ? (
                    <span className="u-red">✕ dropped</span>
                  ) : heldSeat ? (
                    <span style={{ color: "var(--amber)" }}>◐ seat held</span>
                  ) : p.connected ? (
                    <span style={{ color: "var(--green)" }}>● live</span>
                  ) : (
                    <span className="u-muted">○ away</span>
                  )}
                </div>
              );
            })}
          </div>
          <div style={{ marginTop: "auto" }} className="btn-stack">
            {isHost ? (
              <>
                <div
                  id="drop-player-consequence"
                  className="note u-center"
                  style={{ fontSize: 12 }}
                >
                  Dropping the fake voids this round and deals fresh cards.
                </div>
                <Btn
                  variant="red"
                  ariaDescribedBy="drop-player-consequence"
                  onClick={() => onDrop(firstId)}
                >
                  Drop {held?.name ?? "them"} and continue
                </Btn>
              </>
            ) : (
              <div className="note u-center" style={{ fontSize: 12 }}>
                The host can carry on without them. If the fake artist drops, the round is voided
                and re-dealt.
              </div>
            )}
          </div>
        </div>
      </Screen>
    </div>
  );
}

export function ReconnectingBanner({ attempt }: { attempt: number }) {
  const message =
    attempt >= 4
      ? "Still reconnecting · your seat and locked actions are being held"
      : "Connection lost · reconnecting…";
  return (
    <div
      className="kicker"
      role="status"
      aria-live="polite"
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 40,
        background: "var(--ink)",
        color: "var(--gold)",
        padding: "12px 20px",
        display: "flex",
        justifyContent: "space-between",
      }}
    >
      <span className="pulse" style={{ color: "var(--cream)" }}>
        {message}
      </span>
    </div>
  );
}
