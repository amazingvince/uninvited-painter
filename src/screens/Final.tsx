// C6 Close of exhibition — winner plus every drawing made. Publishing hangs
// the whole game at a permanent /a/:id page; the PNG contact sheet remains as
// the offline keepsake.

import { useState } from "react";
import type { ArchiveEntry, Player } from "../../shared/types";
import { StrokePaths } from "../components/CanvasBoard";
import { contactSheetPng, drawingPng, publishArchive, shareOrDownload } from "../lib/share";
import { Screen, Btn, Kicker } from "../components/ui";

export function Final({
  players,
  archive,
  totalRounds,
  onAgain,
  waiting,
}: {
  players: Player[];
  archive: ArchiveEntry[];
  totalRounds: number;
  onAgain?: () => void;
  waiting?: string;
}) {
  const ranked = [...players].sort((a, b) => b.score - a.score);
  const winner = ranked[0];
  const undetected = archive.filter(
    (e) => e.outcome === "survived" && e.fakeName === winner?.name,
  ).length;
  const [publishState, setPublishState] = useState<
    { kind: "idle" } | { kind: "busy" } | { kind: "done"; url: string } | { kind: "error" }
  >({ kind: "idle" });

  const publish = async () => {
    if (publishState.kind === "busy") return;
    setPublishState({ kind: "busy" });
    try {
      const url = await publishArchive({
        title: `${winner?.name ?? "?"} takes the gallery`,
        players: ranked.map((p) => ({ name: p.name, colorIndex: p.colorIndex, score: p.score })),
        // Keep in sync with the server's 48-entry cap (long score-to-10 games).
        entries: archive.slice(-48),
      });
      setPublishState({ kind: "done", url });
      try {
        await navigator.clipboard.writeText(url);
      } catch {
        /* clipboard unavailable */
      }
      try {
        await navigator.share?.({ title: "The Uninvited Painter — our gallery", url });
      } catch {
        /* cancelled */
      }
    } catch {
      setPublishState({ kind: "error" });
    }
  };

  return (
    <Screen>
      <div style={{ background: "var(--red)", color: "var(--cream-on-red)", padding: "22px 20px", flex: "none" }}>
        <Kicker>Exhibition closed · {totalRounds} rounds</Kicker>
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
        <div className="archive-grid">
          {archive.map((entry) => (
            <button
              key={entry.roundNo}
              className="archive-cell"
              onClick={() =>
                drawingPng(entry.strokes, `${String(entry.roundNo).padStart(2, "0")} ${entry.word}`).then(
                  (blob) => shareOrDownload(blob, `painter-${entry.roundNo}-${entry.word}.png`),
                )
              }
            >
              <svg viewBox="0 0 1000 1000">
                <StrokePaths strokes={entry.strokes} width={27} />
              </svg>
              <span className="archive-label">
                {String(entry.roundNo).padStart(2, "0")} {entry.word}
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
          <button
            className="btn btn--outline"
            style={{ fontSize: 13, letterSpacing: "0.02em" }}
            onClick={() => navigator.clipboard?.writeText(publishState.url).catch(() => {})}
          >
            {publishState.url.replace(/^https?:\/\//, "")} — copied
          </button>
        ) : (
          <Btn variant="outline" onClick={publish}>
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
          onClick={() =>
            contactSheetPng(archive, `${winner?.name ?? "?"} takes the gallery`).then((blob) =>
              shareOrDownload(blob, "painter-archive.png"),
            )
          }
        >
          Save as PNG instead
        </button>
      </div>
    </Screen>
  );
}

function numberWord(n: number): string {
  const words = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven"];
  return words[n] ?? String(n);
}
