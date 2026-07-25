// B4 / D5 Spectate — live stroke with a moving nib. Online: this is what
// everyone not drawing sees. Watch the line arrive as it's drawn.

import type { ReactNode } from "react";
import { SEAT_COLORS } from "../../shared/palette";
import type { Player, RoundState, Stroke } from "../../shared/types";
import { CanvasBoard, type LiveStroke } from "../components/CanvasBoard";
import { ClockChip, Screen, Swatch } from "../components/ui";

export interface TurnChip {
  player: Player;
  status: "done" | "now" | "wait";
  suffix?: string;
}

export function turnChips(
  round: Pick<RoundState, "turnOrder" | "schedule" | "turnIndex" | "droppedIds">,
  players: Player[],
  youId?: string | null,
): TurnChip[] {
  const remaining = new Set(round.schedule.slice(round.turnIndex));
  const nowId = round.schedule[round.turnIndex];
  const nextId = round.schedule[round.turnIndex + 1];
  return round.turnOrder
    .filter((id) => !round.droppedIds.includes(id))
    .map((id) => {
      const player = players.find((p) => p.id === id)!;
      if (id === nowId) return { player, status: "now" as const };
      const chip: TurnChip = {
        player,
        status: remaining.has(id) ? "wait" : "done",
      };
      if (id === nextId && id === youId) chip.suffix = " · you next";
      return chip;
    })
    .filter((c) => c.player);
}

export function Spectate({
  kicker,
  drawerName,
  drawerColor,
  strokes,
  live,
  chips,
  strokeNo,
  strokeTotal,
  banner,
  liveBadge,
  deadline,
  onHeaderAction,
  headerAction,
}: {
  kicker: string;
  drawerName: string;
  drawerColor: number;
  strokes: Stroke[];
  live?: Record<string, LiveStroke>;
  chips: TurnChip[];
  strokeNo: number;
  strokeTotal: number;
  banner?: ReactNode;
  liveBadge?: boolean;
  deadline?: number | null;
  onHeaderAction?: () => void;
  headerAction?: string;
}) {
  return (
    <Screen>
      <div className="header header-row">
        {/* The turn changes without anyone touching this device — announce it. */}
        <div aria-live="polite">
          <div className="kicker u-muted" style={{ display: "flex", gap: 10 }}>
            <span>{kicker}</span>
            <ClockChip deadline={deadline} />
          </div>
          <div className="shout" style={{ fontSize: 26 }}>
            {drawerName} is drawing
          </div>
        </div>
        {liveBadge ? (
          <div className="kicker" style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--green)", letterSpacing: "0.1em" }}>
            <span className="pulse" style={{ width: 9, height: 9, borderRadius: "50%", background: "var(--green)" }} />
            Live
          </div>
        ) : (
          <Swatch index={drawerColor} size={18} />
        )}
      </div>
      <CanvasBoard strokes={strokes} live={live} corner={`${String(strokeNo).padStart(2, "0")} / ${strokeTotal}`} />
      <div
        className="grow"
        style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "16px 20px calc(24px + env(safe-area-inset-bottom))", minHeight: 0 }}
      >
        <div className="chips">
          {chips.map(({ player, status, suffix }) => (
            <span
              key={player.id}
              className={status === "now" ? "chip" : status === "done" ? "chip" : "chip chip--wait"}
              style={status === "now" ? { background: SEAT_COLORS[player.colorIndex] } : undefined}
            >
              {player.name}
              {status === "done" ? " ✓" : status === "now" ? " — now" : (suffix ?? "")}
            </span>
          ))}
        </div>
        {banner ?? (
          <div
            className="note"
            style={{ borderTop: "3px solid var(--ink)", paddingTop: 14, fontSize: 14, color: "var(--muted)" }}
          >
            Watch the line arrive as it's drawn. Hesitation is evidence.
          </div>
        )}
        {headerAction && (
          <button
            className="kicker u-muted"
            style={{ letterSpacing: "0.1em", paddingTop: 10, textAlign: "left" }}
            onClick={onHeaderAction}
          >
            {headerAction}
          </button>
        )}
      </div>
    </Screen>
  );
}
