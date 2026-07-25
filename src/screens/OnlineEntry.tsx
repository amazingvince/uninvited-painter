// D1 Online entry — rejoin shortcut restores name, colour and seat.

import { Screen, BackLink, Kicker } from "../components/ui";
import type { LastRoom } from "../lib/storage";

export function OnlineEntry({
  lastRoom,
  busy,
  error,
  onBack,
  onOpenRoom,
  onJoinRoom,
  onRejoin,
}: {
  lastRoom: LastRoom | null;
  busy: boolean;
  error: string | null;
  onBack: () => void;
  onOpenRoom: () => void;
  onJoinRoom: () => void;
  onRejoin: (code: string) => void;
}) {
  return (
    <Screen>
      <div className="header">
        <BackLink label="← Entrance" onClick={onBack} />
        <div className="shout" style={{ fontSize: 30, letterSpacing: "-0.035em" }}>
          Play online
        </div>
      </div>
      <div className="grow" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
        <button
          style={{ background: "var(--red)", color: "var(--cream-on-red)", padding: "22px 20px", display: "flex", flexDirection: "column", gap: 6, textAlign: "left", opacity: busy ? 0.6 : 1 }}
          onClick={onOpenRoom}
          disabled={busy}
        >
          <div className="shout" style={{ fontSize: 26, letterSpacing: "-0.03em" }}>
            {busy ? "Opening…" : "Open a room"}
          </div>
          <div style={{ fontSize: 14, fontWeight: 600 }}>
            You get a code and a link to send. 5–12 painters.
          </div>
        </button>
        <button
          style={{ border: "3px solid var(--ink)", padding: "22px 20px", display: "flex", flexDirection: "column", gap: 6, textAlign: "left" }}
          onClick={onJoinRoom}
        >
          <div className="shout" style={{ fontSize: 26, letterSpacing: "-0.03em" }}>
            Join a room
          </div>
          <div className="small" style={{ fontSize: 14, color: "var(--muted)" }}>
            Four letters from whoever invited you.
          </div>
        </button>
        {error && <div className="small u-red">{error}</div>}
        {lastRoom && (
          <div className="hairline-top" style={{ marginTop: "auto", paddingTop: 14, display: "flex", flexDirection: "column", gap: 8 }}>
            <Kicker style={{ color: "var(--muted)" }}>Last room</Kicker>
            <button
              style={{ display: "flex", justifyContent: "space-between", alignItems: "center", border: "2px dashed var(--rule)", padding: "14px 16px" }}
              onClick={() => onRejoin(lastRoom.code)}
            >
              <span className="shout" style={{ fontSize: 22, letterSpacing: "0.06em" }}>
                {lastRoom.code}
              </span>
              <span className="kicker u-red" style={{ letterSpacing: "0.1em", fontSize: 12 }}>
                Rejoin
              </span>
            </button>
            <div className="note" style={{ fontSize: 12 }}>
              Rooms stay warm for 15 minutes after the last player leaves.
            </div>
          </div>
        )}
      </div>
    </Screen>
  );
}
