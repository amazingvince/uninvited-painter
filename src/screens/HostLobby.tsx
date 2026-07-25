// D2 Host lobby — code is the hero. Only the host sees deck/round controls.

import { deckList } from "../../shared/decks";
import type { PublicRoomState } from "../../shared/protocol";
import { MIN_PLAYERS, MAX_PLAYERS, type Settings } from "../../shared/types";
import { Screen, Kicker, Btn, Swatch } from "../components/ui";

const DECK_CYCLE = ["animals", "food", "movies", "objects", "everything"] as const;
const ROUND_CYCLE = [3, 5, 7];

export function HostLobby({
  state,
  youId,
  isHost,
  shareUrl,
  onSettings,
  onStart,
  onRules,
  onKick,
}: {
  state: PublicRoomState;
  youId: string;
  isHost: boolean;
  shareUrl: string;
  onSettings: (patch: Partial<Settings>) => void;
  onStart: () => void;
  onRules: () => void;
  onKick?: (playerId: string) => void;
}) {
  const deckName =
    state.settings.deckId === "everything"
      ? "Everything"
      : (deckList().find((d) => d.id === state.settings.deckId)?.name ?? state.settings.deckId);

  const cycleDeck = () => {
    const i = DECK_CYCLE.indexOf(state.settings.deckId as (typeof DECK_CYCLE)[number]);
    onSettings({ deckId: DECK_CYCLE[(i + 1) % DECK_CYCLE.length] });
  };
  const cycleRounds = () => {
    const i = ROUND_CYCLE.indexOf(state.settings.rounds);
    onSettings({ rounds: ROUND_CYCLE[(i + 1) % ROUND_CYCLE.length] });
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
    } catch {
      /* clipboard unavailable */
    }
  };
  const shareSheet = async () => {
    try {
      await navigator.share?.({ title: "The Uninvited Painter", url: shareUrl });
    } catch {
      /* cancelled */
    }
  };

  const enough = state.players.length >= MIN_PLAYERS;

  return (
    <Screen>
      <div style={{ background: "var(--ink)", color: "var(--cream)", padding: 20, display: "flex", flexDirection: "column", gap: 4, flex: "none" }}>
        <Kicker style={{ color: "var(--muted-dark)" }}>Room code</Kicker>
        <div className="shout" style={{ fontSize: "clamp(56px, 20vw, 78px)", lineHeight: 0.86, letterSpacing: "0.06em" }}>
          {state.code}
        </div>
        <div style={{ display: "flex", gap: 8, paddingTop: 10 }}>
          <button className="btn btn--red" style={{ padding: 14, fontSize: 14 }} onClick={copyLink}>
            Copy link
          </button>
          <button className="btn" style={{ border: "2px solid var(--cream)", padding: 12, fontSize: 14 }} onClick={shareSheet}>
            Share sheet
          </button>
        </div>
        <div className="small" style={{ color: "var(--muted-dark)", paddingTop: 8 }}>
          {shareUrl.replace(/^https?:\/\//, "")}
        </div>
      </div>
      <div className="grow scroll" style={{ padding: "16px 20px", display: "flex", flexDirection: "column" }}>
        <div className="kicker" style={{ display: "flex", justifyContent: "space-between", color: "var(--muted)", paddingBottom: 8 }}>
          <span>In the room</span>
          <span className="u-red">
            {state.players.length} of {MAX_PLAYERS}
          </span>
        </div>
        {state.players.map((p) => (
          <div key={p.id} className="row" style={{ padding: "12px 0" }}>
            <Swatch index={p.colorIndex} />
            <span style={{ flex: 1, fontSize: 16, fontWeight: 600 }}>
              {p.name}{" "}
              {(p.id === state.hostId || p.id === youId) && (
                <span className="kicker u-muted" style={{ letterSpacing: "0.1em" }}>
                  {p.id === state.hostId ? "host" : ""}
                  {p.id === state.hostId && p.id === youId ? " · " : ""}
                  {p.id === youId ? "you" : ""}
                </span>
              )}
            </span>
            <span style={{ fontSize: 11, fontWeight: 700, color: p.connected ? "var(--green)" : "var(--muted)" }}>
              {p.connected ? "●" : "away"}
            </span>
            {isHost && onKick && p.id !== youId && (
              <button
                style={{ fontSize: 18, color: "var(--muted)", padding: "2px 6px" }}
                onClick={() => onKick(p.id)}
                aria-label={`Remove ${p.name}`}
              >
                ×
              </button>
            )}
          </div>
        ))}
        <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 8, borderTop: "1px solid var(--rule)", paddingTop: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span className="kicker" style={{ fontSize: 13, letterSpacing: "0.08em" }}>
              Deck
            </span>
            {isHost ? (
              <button className="shout" style={{ fontSize: 14 }} onClick={cycleDeck}>
                {deckName} ▾
              </button>
            ) : (
              <span className="shout" style={{ fontSize: 14 }}>
                {deckName}
              </span>
            )}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span className="kicker" style={{ fontSize: 13, letterSpacing: "0.08em" }}>
              Rounds
            </span>
            {isHost ? (
              <button className="shout" style={{ fontSize: 14 }} onClick={cycleRounds}>
                {state.settings.rounds} ▾
              </button>
            ) : (
              <span className="shout" style={{ fontSize: 14 }}>
                {state.settings.rounds}
              </span>
            )}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span className="kicker" style={{ fontSize: 13, letterSpacing: "0.08em" }}>
              Question master
            </span>
            {isHost ? (
              <button
                className="shout"
                style={{ fontSize: 14 }}
                onClick={() => onSettings({ qmMode: state.settings.qmMode === "rotate" ? "off" : "rotate" })}
              >
                {state.settings.qmMode === "rotate" ? "Rotate" : "Off"} ▾
              </button>
            ) : (
              <span className="shout" style={{ fontSize: 14 }}>
                {state.settings.qmMode === "rotate" ? "Rotate" : "Off"}
              </span>
            )}
          </div>
          <button className="kicker u-muted" style={{ letterSpacing: "0.1em", textAlign: "left", paddingTop: 4 }} onClick={onRules}>
            How it works
          </button>
        </div>
      </div>
      <div className="footer footer--rule btn-stack">
        {isHost ? (
          <Btn variant={enough ? "red" : "disabled"} onClick={onStart}>
            Open the round
          </Btn>
        ) : (
          <div className="note u-center pulse">Waiting on the host to open the round</div>
        )}
        <div className="note u-center" style={{ fontSize: 12 }}>
          Needs {MIN_PLAYERS} · late arrivals join the next round
        </div>
      </div>
    </Screen>
  );
}
