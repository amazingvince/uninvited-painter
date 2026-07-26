// C4 Reveal — three copy variants: survived / caught+named / caught+wrong
// (plus voided, the case everyone forgets).

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { voteTally } from "../../shared/engine";
import { guessMatches } from "../../shared/fuzzy";
import type { Outcome, Player, RoundState } from "../../shared/types";
import { ActionNotice, type NoticeTone } from "../components/ActionNotice";
import { StrokePaths } from "../components/CanvasBoard";
import { numberWord } from "../lib/labels";
import { drawingPng, shareOrDownload } from "../lib/share";
import { Screen, Btn } from "../components/ui";

function headline(outcome: Outcome, fake: string): [string, ReactNode] {
  switch (outcome) {
    case "survived":
      return [
        "Attribution",
        <>
          Never
          <br />
          caught.
          <br />
          {fake} walks
        </>,
      ];
    case "caught_named":
      return [
        "Attribution",
        <>
          Caught —<br />
          then the
          <br />
          word fell
        </>,
      ];
    case "caught_wrong":
      return [
        "Attribution",
        <>
          Caught,
          <br />
          and the
          <br />
          guess missed
        </>,
      ];
    case "voided":
      return [
        "Round voided",
        <>
          The fake
          <br />
          artist left
          <br />
          the room
        </>,
      ];
  }
}

function summaryLine(round: RoundState, players: Player[]): string {
  const fake = players.find((p) => p.id === round.fakeId)?.name ?? "?";
  const counts = Object.values(voteTally(round.votes)).sort((a, b) => b - a);
  const voteStr = counts.length >= 2 ? `${counts[0]}–${counts[1]}` : counts.length ? `${counts[0]}–0` : "";
  switch (round.outcome) {
    case "survived":
      return round.accusedId
        ? `The room accused ${players.find((p) => p.id === round.accusedId)?.name ?? "?"} — wrong. ${fake} was the fake all along.`
        : `The vote tied${voteStr ? ` ${voteStr}` : ""}. Ties acquit — ${fake} was never named.`;
    case "caught_named":
      return `Voted out ${voteStr}. Guessed the word and takes the round anyway.`;
    case "caught_wrong":
      return `Voted out ${voteStr}. Guessed “${round.guess ?? "…"}” — wrong. The artists hold the wall.`;
    case "voided":
      return "Their seat timed out mid-round. No scores — the word goes back in the deck and the cards are re-dealt.";
    default:
      return "";
  }
}

export function Reveal({
  round,
  players,
  onNext,
  nextLabel,
  waiting,
}: {
  round: RoundState;
  players: Player[];
  /** Unused: the caller composes nextLabel, so it owns the round arithmetic. */
  totalRounds?: number;
  isLastRound?: boolean;
  onNext?: () => void;
  nextLabel: string;
  waiting?: string;
}) {
  const outcome = round.outcome ?? "survived";
  const fake = players.find((p) => p.id === round.fakeId);
  // The picture redraws itself with the fake's strokes spotlit, then floods
  // back to full colour.
  const [spotlight, setSpotlight] = useState(true);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saveTone, setSaveTone] = useState<NoticeTone>("neutral");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSpotlight(false), 1700);
    return () => clearTimeout(t);
  }, []);
  const qm = round.qmId ? players.find((p) => p.id === round.qmId) : null;
  const [kicker, title] = headline(outcome, fake?.name ?? "?");
  const voided = outcome === "voided";
  const year = new Date().getFullYear();
  const artistCount = round.turnOrder.length - round.droppedIds.length;
  const critic = round.ai.criticStatus === "ready" ? round.ai.critic : null;
  const aiComparisons = [
    ...(critic?.subjectGuess
      ? [
          guessMatches(critic.subjectGuess, round.word)
            ? "Luna guessed it"
            : "Luna invented something else",
        ]
      : []),
    ...(critic?.detective
      ? [
          critic.detective.playerId === round.fakeId
            ? "Luna found the fake"
            : "Luna accused an innocent",
        ]
      : []),
  ];
  const saveDrawing = async () => {
    if (saving) return;
    setSaving(true);
    setSaveTone("neutral");
    setSaveMessage("Preparing the drawing…");
    try {
      const blob = await drawingPng(
        round.strokes,
        `${String(round.roundNo).padStart(2, "0")} ${round.word}`,
      );
      const result = await shareOrDownload(
        blob,
        `painter-${round.roundNo}-${round.word}.png`,
      );
      if (result === "done") {
        setSaveTone("success");
        setSaveMessage("Drawing saved.");
      } else if (result === "cancelled") {
        setSaveTone("neutral");
        setSaveMessage("Saving cancelled.");
      } else {
        setSaveTone("error");
        setSaveMessage("Couldn’t save the drawing. Try again.");
      }
    } catch {
      setSaveTone("error");
      setSaveMessage("Couldn’t save the drawing. Try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen>
      <div className="grow scroll" style={{ display: "flex", flexDirection: "column", padding: "18px 20px", gap: 18 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="kicker u-red">
            {kicker} · Round {round.roundNo}
          </div>
          <div className="shout" style={{ fontSize: 46, lineHeight: 0.88, letterSpacing: "-0.045em" }}>
            {title}
          </div>
          <div className="body-copy">
            {!voided && (
              <>
                The word was{" "}
                <span style={{ background: "var(--red)", color: "var(--cream-on-red)", padding: "1px 6px", fontWeight: 700, textTransform: "uppercase" }}>
                  {round.word}
                </span>
                {". "}
              </>
            )}
            {summaryLine(round, players)}
          </div>
        </div>
        {!voided && (
          <div style={{ display: "flex", alignItems: "center", gap: 14, borderTop: "3px solid var(--ink)", borderBottom: "3px solid var(--ink)", padding: "14px 0" }}>
            <div
              role="img"
              aria-label={`Finished round ${round.roundNo} drawing.`}
              style={{ width: 112, height: 112, background: "var(--paper)", border: "2px solid var(--ink)", position: "relative", flex: "none" }}
            >
              <svg className="draw-in" viewBox="0 0 1000 1000" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
                <StrokePaths
                  strokes={round.strokes}
                  width={23}
                  highlight={spotlight ? round.fakeId : null}
                />
              </svg>
            </div>
            <div className="small" style={{ lineHeight: 1.45, textTransform: "uppercase", letterSpacing: "0.04em", fontSize: 13 }}>
              {critic?.title ?? "Untitled"} ({round.word}), {year}
              <br />
              <span className="u-muted">
                {numberWord(artistCount)} hands, ink on glass
                <br />
                Est. value: bragging rights
              </span>
            </div>
          </div>
        )}
        {!voided && aiComparisons.length > 0 && (
          <div
            style={{
              background: "var(--cream)",
              border: "1px solid var(--rule)",
              padding: "11px 13px",
              display: "grid",
              gap: 4,
            }}
          >
            <div className="kicker u-muted" style={{ fontSize: 10 }}>
              Luna&apos;s non-scoring opinion
            </div>
            {aiComparisons.map((line) => (
              <div key={line} className="small" style={{ fontWeight: 700 }}>
                {line}
              </div>
            ))}
          </div>
        )}
        {!voided && (
          <div>
            <div className="kicker u-muted">Official score</div>
            <div className="stagger-in">
              {[
                {
                  label: (
                    <>
                      {fake?.name}{" "}
                      <span className="u-red" style={{ fontSize: 11 }}>
                        FAKE
                      </span>
                    </>
                  ),
                  delta: round.scoreDelta[round.fakeId] ?? 0,
                },
                ...(qm
                  ? [
                      {
                        label: (
                          <>
                            {qm.name}{" "}
                            <span className="u-muted" style={{ fontSize: 11 }}>
                              QUESTION MASTER
                            </span>
                          </>
                        ),
                        delta: round.scoreDelta[qm.id] ?? 0,
                      },
                    ]
                  : []),
                {
                  label: <span className="u-muted">Every real artist</span>,
                  delta: outcome === "caught_wrong" ? 1 : 0,
                },
              ].map((row, i) => (
                <div
                  key={i}
                  style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 0", borderBottom: "1px solid var(--rule)" }}
                >
                  <span className="shout" style={{ fontSize: 15, letterSpacing: "-0.02em" }}>
                    {row.label}
                  </span>
                  <span className="shout" style={{ fontSize: 22, color: row.delta > 0 ? "var(--red)" : "var(--muted)" }}>
                    +{row.delta}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
        <div style={{ marginTop: "auto" }} className="btn-stack reveal-actions">
          {onNext ? (
            <Btn variant="red" onClick={onNext}>
              {nextLabel}
            </Btn>
          ) : (
            <div className="note u-center pulse">{waiting ?? "Waiting for the host…"}</div>
          )}
          {!voided && (
            <Btn
              variant="outline"
              disabled={saving}
              ariaDescribedBy="save-drawing-status"
              onClick={() => void saveDrawing()}
            >
              {saving ? "Preparing PNG…" : "Save this drawing as a PNG"}
            </Btn>
          )}
          <ActionNotice
            id="save-drawing-status"
            message={saveMessage}
            tone={saveTone}
          />
        </div>
      </div>
    </Screen>
  );
}
