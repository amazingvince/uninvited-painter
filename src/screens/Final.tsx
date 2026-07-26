// C6 Close of exhibition — winner plus every drawing made. Publishing hangs
// the whole game at a permanent /a/:id page; the PNG contact sheet remains as
// the offline keepsake.

import { useState } from "react";
import type { ArchiveEntry, Player } from "../../shared/types";
import { ActionNotice, type NoticeTone } from "../components/ActionNotice";
import { StrokePaths } from "../components/CanvasBoard";
import { copyText, shareLink } from "../lib/actionResult";
import { criticAccuracy, criticChoice } from "../lib/aiStats";
import { numberWord } from "../lib/labels";
import { contactSheetPng, drawingPng, publishArchive, shareOrDownload } from "../lib/share";
import { renditionImageUrl } from "./RenditionReveal";
import { Confetti } from "../components/Confetti";
import { Screen, Btn, Kicker } from "../components/ui";

export function Final({
  players,
  archive,
  onAgain,
  waiting,
}: {
  players: Player[];
  archive: ArchiveEntry[];
  /** Unused: the header counts the rounds actually played, not the cap. */
  totalRounds?: number;
  onAgain?: () => void;
  waiting?: string;
}) {
  const ranked = [...players].sort((a, b) => b.score - a.score);
  const winner = ranked[0];
  const undetected = archive.filter(
    (e) => e.outcome === "survived" && e.fakeName === winner?.name,
  ).length;
  const choice = criticChoice(archive);
  const accuracy = criticAccuracy(archive);
  const [publishState, setPublishState] = useState<
    { kind: "idle" } | { kind: "busy" } | { kind: "done"; url: string } | { kind: "error" }
  >({ kind: "idle" });
  const [notice, setNotice] = useState<{
    message: string;
    tone: NoticeTone;
  } | null>(null);

  const noticeForResult = (
    result: Awaited<ReturnType<typeof shareOrDownload>>,
    doneMessage: string,
  ) => {
    if (result === "done") {
      setNotice({ message: doneMessage, tone: "success" });
    } else if (result === "cancelled") {
      setNotice({ message: "Saving cancelled", tone: "neutral" });
    } else {
      setNotice({
        message: "Could not save — try again or use the archive link",
        tone: "error",
      });
    }
  };

  const publish = async () => {
    if (publishState.kind === "busy") return;
    setNotice(null);
    setPublishState({ kind: "busy" });
    try {
      const url = await publishArchive({
        title: `${winner?.name ?? "?"} takes the gallery`,
        players: ranked.map((p) => ({ name: p.name, colorIndex: p.colorIndex, score: p.score })),
        // Keep in sync with the server's 48-entry cap (long score-to-10 games).
        entries: archive.slice(-48),
      });
      setPublishState({ kind: "done", url });
    } catch {
      setPublishState({ kind: "error" });
      setNotice({
        message: "Publishing failed — your finished game is still here. Try again.",
        tone: "error",
      });
    }
  };

  const copyArchiveLink = async (url: string) => {
    const result = await copyText(url);
    setNotice(
      result === "done"
        ? { message: "Archive link copied", tone: "success" }
        : {
            message: "Could not copy — select the visible URL",
            tone: "error",
          },
    );
  };

  const shareArchive = async (url: string) => {
    const result = await shareLink({
      title: "The Uninvited Painter — our gallery",
      url,
    });
    if (result === "done") {
      setNotice({ message: "Archive shared", tone: "success" });
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

  const saveDrawing = async (entry: ArchiveEntry) => {
    try {
      const blob = await drawingPng(
        entry.strokes,
        `${String(entry.roundNo).padStart(2, "0")} ${entry.word}`,
      );
      noticeForResult(
        await shareOrDownload(
          blob,
          `painter-${entry.roundNo}-${entry.word}.png`,
        ),
        "Drawing saved",
      );
    } catch {
      setNotice({ message: "Could not save the drawing", tone: "error" });
    }
  };

  const saveContactSheet = async () => {
    try {
      const blob = await contactSheetPng(
        archive,
        `${winner?.name ?? "?"} takes the gallery`,
      );
      noticeForResult(
        await shareOrDownload(blob, "painter-archive.png"),
        "Archive PNG saved",
      );
    } catch {
      setNotice({ message: "Could not save the archive PNG", tone: "error" });
    }
  };

  return (
    <Screen>
      <Confetti />
      <div style={{ background: "var(--red)", color: "var(--cream-on-red)", padding: "22px 20px", flex: "none" }}>
        <Kicker>
          Exhibition closed · {archive.length} {archive.length === 1 ? "round" : "rounds"}
        </Kicker>
        <div className="shout" style={{ fontSize: 44, lineHeight: 0.88, letterSpacing: "-0.045em" }}>
          {winner?.name} takes
          <br />
          the gallery
        </div>
        <div style={{ fontSize: 15, fontWeight: 600, paddingTop: 8 }}>
          {winner?.score} points.
          {undetected > 0 && ` ${undetected === 1 ? "One round" : `${numberWord(undetected)} rounds`} undetected.`}
        </div>
      </div>
      <div className="grow scroll" style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
        <Kicker style={{ color: "var(--muted)" }}>The archive · tap any to save or share</Kicker>
        {(choice || accuracy.subjectTotal > 0 || accuracy.detectiveTotal > 0) && (
          <div className="ai-gallery-stats">
            {choice && (
              <div>
                <div className="kicker u-red">Luna&apos;s choice</div>
                <div className="shout" style={{ fontSize: 20 }}>
                  Round {choice.roundNo} · {choice.ai?.critic?.title ?? choice.word}
                </div>
                <div className="small u-muted">
                  {choice.ai?.critic?.rating}/10 · {choice.ai?.critic?.ratingTag}
                </div>
              </div>
            )}
            {(accuracy.subjectTotal > 0 || accuracy.detectiveTotal > 0) && (
              <div className="small" style={{ lineHeight: 1.5 }}>
                {accuracy.subjectTotal > 0 && (
                  <div>
                    Blind guesses: {accuracy.subjectCorrect}/{accuracy.subjectTotal}
                  </div>
                )}
                {accuracy.detectiveTotal > 0 && (
                  <div>
                    Fake picks: {accuracy.detectiveCorrect}/{accuracy.detectiveTotal}{" "}
                    <span className="u-muted">(still never scoring)</span>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
        <div className="archive-grid">
          {archive.map((entry) => (
            <button
              key={entry.roundNo}
              className="archive-cell"
              onClick={() => void saveDrawing(entry)}
            >
              <span
                className={
                  entry.ai?.renditionStatus === "ready" &&
                  entry.ai.renditionId
                    ? "archive-art archive-art--pair"
                    : "archive-art"
                }
              >
                <svg viewBox="0 0 1000 1000" aria-label={`Original round ${entry.roundNo} drawing`}>
                  <StrokePaths strokes={entry.strokes} width={27} />
                </svg>
                {entry.ai?.renditionStatus === "ready" &&
                  entry.ai.renditionId && (
                    <img
                      src={renditionImageUrl(entry.ai.renditionId)}
                      alt={`AI-generated realistic rendition for round ${entry.roundNo}`}
                    />
                  )}
              </span>
              <span className="archive-label">
                {String(entry.roundNo).padStart(2, "0")} {entry.word}
                {entry.ai?.critic?.title && (
                  <small>
                    {entry.ai.critic.title}
                    {entry.ai.critic.rating
                      ? ` · ${entry.ai.critic.rating}/10`
                      : ""}
                  </small>
                )}
              </span>
            </button>
          ))}
        </div>
        <div style={{ paddingTop: 4 }}>
          {ranked.slice(0, 12).map((p, i) => (
            <div key={p.id} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid var(--rule)", fontSize: 14, fontWeight: 600 }}>
              <span>
                <span className="u-muted" style={{ display: "inline-block", width: 22 }}>
                  {i + 1}
                </span>
                {p.name}
              </span>
              <span className="shout" style={{ fontSize: 16 }}>
                {p.score}
              </span>
            </div>
          ))}
        </div>
      </div>
      <div className="footer footer--rule btn-stack">
        {onAgain ? (
          <Btn variant="ink" onClick={onAgain}>
            Same crowd, again
          </Btn>
        ) : (
          <div className="note u-center pulse">{waiting ?? "Waiting for the host…"}</div>
        )}
        {publishState.kind === "done" ? (
          <div style={{ display: "grid", gap: 8 }}>
            <div className="kicker u-red">Published</div>
            <div
              className="small u-center"
              style={{ overflowWrap: "anywhere" }}
            >
              {publishState.url.replace(/^https?:\/\//, "")}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                className="btn btn--outline"
                style={{ flex: 1, fontSize: 13 }}
                onClick={() => void copyArchiveLink(publishState.url)}
              >
                Copy archive link
              </button>
              <button
                className="btn btn--outline"
                style={{ flex: 1, fontSize: 13 }}
                onClick={() => void shareArchive(publishState.url)}
              >
                Share archive
              </button>
            </div>
          </div>
        ) : (
          <Btn variant="outline" onClick={() => void publish()}>
            {publishState.kind === "busy"
              ? "Hanging it in the archive…"
              : publishState.kind === "error"
                ? "Publishing failed — try again"
                : "Publish the archive"}
          </Btn>
        )}
        <button
          className="kicker u-muted u-center"
          style={{ letterSpacing: "0.1em", padding: "4px 0" }}
          onClick={() => void saveContactSheet()}
        >
          Save as PNG instead
        </button>
        <ActionNotice
          message={notice?.message ?? null}
          tone={notice?.tone}
        />
      </div>
    </Screen>
  );
}
