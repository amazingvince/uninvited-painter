// D2 Host lobby — code is the hero, QR beside it. Only the host sees the
// deck/length/passes/clock controls.

import { deckList } from "../../shared/decks";
import { aiEnabled } from "../../shared/engine";
import type { PublicRoomState } from "../../shared/protocol";
import { HOUSE_MIN_WORDS, MIN_PLAYERS, MAX_PLAYERS, type Settings } from "../../shared/types";
import { QrCode } from "../components/QrCode";
import { Screen, Kicker, Btn, Swatch } from "../components/ui";

const DECK_CYCLE = ["animals", "food", "movies", "objects", "everything", "house"] as const;

function deckLabel(id: string): string {
  if (id === "everything") return "Everything";
  if (id === "house") return "House deck";
  return deckList().find((d) => d.id === id)?.name ?? id;
}

export function HostLobby({
  state,
  youId,
  isHost,
  shareUrl,
  onSettings,
  onStart,
  onRules,
  onKick,
  onHouseWords,
  onLock,
}: {
  state: PublicRoomState;
  youId: string;
  isHost: boolean;
  shareUrl: string;
  onSettings: (patch: Partial<Settings>) => void;
  onStart: () => void;
  onRules: () => void;
  onKick?: (playerId: string) => void;
  onHouseWords: () => void;
  /** Host only: close the room to newcomers. */
  onLock?: (locked: boolean) => void;
}) {
  const s = state.settings;

  const cycleDeck = () => {
    const i = DECK_CYCLE.indexOf(s.deckId as (typeof DECK_CYCLE)[number]);
    onSettings({ deckId: DECK_CYCLE[(i + 1) % DECK_CYCLE.length] });
  };
  const cycleLength = () => {
    if (s.winMode === "score10") onSettings({ winMode: "rounds", rounds: 3 });
    else if (s.rounds === 3) onSettings({ rounds: 5 });
    else if (s.rounds === 5) onSettings({ rounds: 7 });
    else onSettings({ winMode: "score10" });
  };
  const cyclePasses = () => onSettings({ passes: (s.passes % 3) + 1 });
  const cycleClock = () =>
    onSettings({ strokeClock: s.strokeClock === 0 ? 60 : s.strokeClock === 60 ? 90 : 0 });
  const cyclePen = () => onSettings({ penMode: s.penMode === "line" ? "free" : "line" });
  const cycleInk = () =>
    onSettings({ inkLimit: s.inkLimit === 0 ? 120 : s.inkLimit === 120 ? 60 : 0 });
  const cyclePresence = () =>
    onSettings({ presence: s.presence === "strict" ? "relaxed" : "strict" });
  const cycleTone = () =>
    onSettings({
      aiTone:
        s.aiTone === "witty"
          ? "savage"
          : s.aiTone === "savage"
            ? "absurd"
            : "witty",
    });

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
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
  const lengthLabel = s.winMode === "score10" ? "First to 10" : `${s.rounds} rounds`;

  const settingRow = (label: string, value: string, onCycle: () => void) => (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <span className="kicker" style={{ fontSize: 13, letterSpacing: "0.08em" }}>
        {label}
      </span>
      {isHost ? (
        <button className="shout" style={{ fontSize: 14 }} onClick={onCycle}>
          {value} ▾
        </button>
      ) : (
        <span className="shout" style={{ fontSize: 14 }}>
          {value}
        </span>
      )}
    </div>
  );

  return (
    <Screen>
      <div style={{ background: "var(--ink)", color: "var(--cream)", padding: 20, flex: "none" }}>
        <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
            <Kicker style={{ color: "var(--muted-dark)" }}>Room code</Kicker>
            <div className="shout" style={{ fontSize: "clamp(48px, 16vw, 72px)", lineHeight: 0.86, letterSpacing: "0.06em" }}>
              {state.code}
            </div>
            <div className="small" style={{ color: "var(--muted-dark)", paddingTop: 6, overflowWrap: "anywhere" }}>
              {shareUrl.replace(/^https?:\/\//, "")}
            </div>
          </div>
          <QrCode url={shareUrl} size={116} />
        </div>
        <div style={{ display: "flex", gap: 8, paddingTop: 12 }}>
          <button className="btn btn--red" style={{ padding: 14, fontSize: 14 }} onClick={() => copy(shareUrl)}>
            Copy link
          </button>
          <button className="btn" style={{ border: "2px solid var(--cream)", padding: 12, fontSize: 14 }} onClick={shareSheet}>
            Share sheet
          </button>
        </div>
        <button
          className="kicker"
          style={{ color: "var(--muted-dark)", letterSpacing: "0.1em", paddingTop: 10 }}
          onClick={() => copy(shareUrl.replace("/r/", "/w/"))}
        >
          Copy spectator link — watch only, no seat
        </button>
        {isHost && onLock && (
          <button
            className="kicker"
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              letterSpacing: "0.1em",
              paddingTop: 10,
              color: state.locked ? "var(--gold)" : "var(--muted-dark)",
            }}
            onClick={() => onLock(!state.locked)}
            aria-pressed={!!state.locked}
          >
            <span>
              {state.locked
                ? "Room locked — nobody else can take a seat"
                : "Lock the room once everyone is in"}
            </span>
            <span className="shout" style={{ fontSize: 13 }}>
              {state.locked ? "LOCKED" : "OPEN"}
            </span>
          </button>
        )}
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
          {settingRow("Deck", deckLabel(s.deckId), cycleDeck)}
          <button
            style={{ display: "flex", justifyContent: "space-between", alignItems: "center", border: "2px dashed var(--rule)", padding: "10px 12px" }}
            onClick={onHouseWords}
          >
            <span className="kicker" style={{ fontSize: 12, letterSpacing: "0.08em" }}>
              Write house words
            </span>
            <span className="shout" style={{ fontSize: 14, color: state.houseWordCount >= HOUSE_MIN_WORDS ? "var(--green)" : "var(--red)" }}>
              {state.houseWordCount} in the pot
            </span>
          </button>
          {settingRow("Length", lengthLabel, cycleLength)}
          {settingRow("Passes", String(s.passes), cyclePasses)}
          {settingRow("Pen", s.penMode === "line" ? "One line" : "Free ink", cyclePen)}
          {settingRow(
            "Ink per turn",
            s.inkLimit === 0 ? "Unlimited" : s.inkLimit === 120 ? "Long" : "Short",
            cycleInk,
          )}
          {settingRow("Stroke clock", s.strokeClock === 0 ? "Off" : `${s.strokeClock}s`, cycleClock)}
          {settingRow(
            "Away players",
            s.presence === "strict" ? "Pause 30s" : "Wait for them",
            cyclePresence,
          )}
          {settingRow(
            "Question master",
            s.qmMode === "rotate" ? "Rotate" : "Auto word — all play",
            () => onSettings({ qmMode: s.qmMode === "rotate" ? "off" : "rotate" }),
          )}
          {settingRow(
            "Luna critic",
            s.aiCritic ? "On" : "Off",
            () => onSettings({ aiCritic: !s.aiCritic }),
          )}
          {settingRow(
            "AI detective",
            s.aiDetective ? "On · non-scoring" : "Off",
            () => onSettings({ aiDetective: !s.aiDetective }),
          )}
          {aiEnabled(s) &&
            settingRow(
              "AI tone",
              s.aiTone[0].toUpperCase() + s.aiTone.slice(1),
              cycleTone,
            )}
          {aiEnabled(s) && (
            <div className="note" style={{ fontSize: 11, lineHeight: 1.4 }}>
              OpenAI reviews the finished drawing while ballots come in. GPT
              Image 2 also makes its realistic version.
            </div>
          )}
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
