// D2 Host lobby — code is the hero, QR beside it. Only the host can change
// room rules; everyone can read the selected values.

import { useState } from "react";
import { aiEnabled } from "../../shared/engine";
import type { PublicRoomState } from "../../shared/protocol";
import {
  HOUSE_MIN_WORDS,
  MIN_PLAYERS,
  MAX_PLAYERS,
  type Settings,
} from "../../shared/types";
import { ActionNotice, type NoticeTone } from "../components/ActionNotice";
import { QrCode } from "../components/QrCode";
import { SettingSelect } from "../components/SettingSelect";
import { Screen, Kicker, Btn, Swatch } from "../components/ui";
import { copyText, shareLink } from "../lib/actionResult";
import {
  SETTING_OPTIONS,
  advancedSettingsSummary,
  type SettingOption,
} from "../lib/settingsOptions";

type LengthChoice = "rounds-3" | "rounds-5" | "rounds-7" | "score10";

const LENGTH_OPTIONS = [
  { value: "rounds-3", label: "3 rounds" },
  { value: "rounds-5", label: "5 rounds" },
  { value: "rounds-7", label: "7 rounds" },
  { value: "score10", label: "First to 10" },
] as const satisfies readonly SettingOption<LengthChoice>[];

const ON_OFF_OPTIONS = [
  { value: "on", label: "On" },
  { value: "off", label: "Off" },
] as const satisfies readonly SettingOption<"on" | "off">[];

const DETECTIVE_OPTIONS = [
  { value: "on", label: "On · non-scoring" },
  { value: "off", label: "Off" },
] as const satisfies readonly SettingOption<"on" | "off">[];

function selectedLabel<T extends string | number>(
  value: T,
  options: readonly SettingOption<T>[],
): string {
  return options.find((option) => option.value === value)?.label ?? String(value);
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
  const [notice, setNotice] = useState<{
    message: string;
    tone: NoticeTone;
  } | null>(null);
  const canShare =
    typeof navigator !== "undefined" && typeof navigator.share === "function";

  const copy = async (text: string, label: "Room" | "Spectator") => {
    const result = await copyText(text);
    setNotice(
      result === "done"
        ? { message: `${label} link copied`, tone: "success" }
        : {
            message: "Could not copy — select the visible URL",
            tone: "error",
          },
    );
  };
  const shareSheet = async () => {
    const result = await shareLink({
      title: "The Uninvited Painter",
      url: shareUrl,
    });
    if (result === "done") {
      setNotice({ message: "Room link shared", tone: "success" });
    } else if (result === "cancelled") {
      setNotice({ message: "Sharing cancelled", tone: "neutral" });
    } else {
      setNotice({
        message:
          result === "unavailable"
            ? "Sharing is not available — copy the link instead"
            : "Could not share — copy the link instead",
        tone: "error",
      });
    }
  };

  const enough = state.players.length >= MIN_PLAYERS;
  const houseWordsNeeded =
    s.deckId === "house"
      ? Math.max(0, HOUSE_MIN_WORDS - state.houseWordCount)
      : 0;
  const canStart = enough && houseWordsNeeded === 0;
  const lengthValue: LengthChoice =
    s.winMode === "score10" ? "score10" : `rounds-${s.rounds}` as LengthChoice;

  const changeLength = (value: LengthChoice) => {
    if (value === "score10") {
      onSettings({ winMode: "score10" });
      return;
    }
    onSettings({
      winMode: "rounds",
      rounds: Number(value.replace("rounds-", "")),
    });
  };

  const settingControl = <T extends string | number,>(
    label: string,
    value: T,
    options: readonly SettingOption<T>[],
    onChange: (next: T) => void,
  ) =>
    isHost ? (
      <SettingSelect
        label={label}
        value={value}
        options={options}
        onChange={onChange}
      />
    ) : (
      <div className="setting-readout">
        <span className="kicker">{label}</span>
        <span className="shout">{selectedLabel(value, options)}</span>
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
          <button className="btn btn--red" style={{ padding: 14, fontSize: 14 }} onClick={() => void copy(shareUrl, "Room")}>
            Copy link
          </button>
          {canShare && (
            <button className="btn" style={{ border: "2px solid var(--cream)", padding: 12, fontSize: 14 }} onClick={() => void shareSheet()}>
              Share sheet
            </button>
          )}
        </div>
        <button
          className="kicker"
          style={{ color: "var(--muted-dark)", letterSpacing: "0.1em", paddingTop: 10 }}
          onClick={() =>
            void copy(shareUrl.replace("/r/", "/w/"), "Spectator")
          }
        >
          Copy spectator link — watch only, no seat
        </button>
        <ActionNotice
          message={notice?.message ?? null}
          tone={notice?.tone}
        />
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
      <div className="screen-scroll" style={{ padding: "16px 20px", display: "flex", flexDirection: "column" }}>
        <div className="kicker" style={{ display: "flex", justifyContent: "space-between", color: "var(--muted)", paddingBottom: 8 }}>
          <span>In the room</span>
          <span className="u-red">
            {state.players.length} of {MAX_PLAYERS}
          </span>
        </div>
        {state.players.map((p) => {
          const held = state.holds[p.id] !== undefined;
          return (
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
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: held
                    ? "var(--amber)"
                    : p.connected
                      ? "var(--green)"
                      : "var(--muted)",
                }}
              >
                {held ? "◐ seat held" : p.connected ? "● live" : "○ away"}
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
          );
        })}
        <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 8, borderTop: "1px solid var(--rule)", paddingTop: 12 }}>
          {settingControl(
            "Deck",
            s.deckId,
            SETTING_OPTIONS.deck,
            (deckId) => onSettings({ deckId }),
          )}
          <button
            className="tap-target"
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
          {settingControl("Length", lengthValue, LENGTH_OPTIONS, changeLength)}
          {settingControl(
            "Passes",
            s.passes,
            SETTING_OPTIONS.passes,
            (passes) => onSettings({ passes }),
          )}
          <details className="settings-disclosure">
            <summary>
              <span className="shout">Advanced rules</span>
              <span className="small u-muted">
                {advancedSettingsSummary(s, "online")}
              </span>
            </summary>
            <div className="settings-disclosure__body">
              {settingControl(
                "Pen",
                s.penMode,
                SETTING_OPTIONS.pen,
                (penMode) => onSettings({ penMode }),
              )}
              {settingControl(
                "Ink per turn",
                s.inkLimit,
                SETTING_OPTIONS.ink,
                (inkLimit) => onSettings({ inkLimit }),
              )}
              {settingControl(
                "Stroke clock",
                s.strokeClock,
                SETTING_OPTIONS.clock,
                (strokeClock) => onSettings({ strokeClock }),
              )}
              {settingControl(
                "Away players",
                s.presence,
                SETTING_OPTIONS.presence,
                (presence) => onSettings({ presence }),
              )}
              {settingControl(
                "Question master",
                s.qmMode,
                SETTING_OPTIONS.qm,
                (qmMode) => onSettings({ qmMode }),
              )}
              {settingControl(
                "Luna critic",
                s.aiCritic ? "on" : "off",
                ON_OFF_OPTIONS,
                (value) => onSettings({ aiCritic: value === "on" }),
              )}
              {settingControl(
                "AI detective",
                s.aiDetective ? "on" : "off",
                DETECTIVE_OPTIONS,
                (value) => onSettings({ aiDetective: value === "on" }),
              )}
              {aiEnabled(s) &&
                settingControl(
                  "AI tone",
                  s.aiTone,
                  SETTING_OPTIONS.tone,
                  (aiTone) => onSettings({ aiTone }),
                )}
              {aiEnabled(s) && (
                <div className="note" style={{ fontSize: 11, lineHeight: 1.4 }}>
                  OpenAI reviews the finished drawing while ballots come in. GPT
                  Image 2 also makes its realistic version.
                </div>
              )}
            </div>
          </details>
          <button className="kicker u-muted" style={{ letterSpacing: "0.1em", textAlign: "left", paddingTop: 4 }} onClick={onRules}>
            How it works
          </button>
        </div>
      </div>
      <div className="action-footer btn-stack">
        {isHost ? (
          <Btn
            variant={canStart ? "red" : "disabled"}
            disabled={!canStart}
            onClick={onStart}
          >
            {houseWordsNeeded > 0
              ? `House deck needs ${houseWordsNeeded} more`
              : "Open the round"}
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
