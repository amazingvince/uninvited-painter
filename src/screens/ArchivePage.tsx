// A published game, hanging at its permanent URL — the shared archive page
// the design left "not yet designed".

import { useEffect, useState } from "react";
import type { ArchiveEntry } from "../../shared/types";
import { StrokePaths } from "../components/CanvasBoard";
import { Screen, Btn, Kicker, Swatch } from "../components/ui";

interface PublishedArchive {
  title: string;
  players: { name: string; colorIndex: number; score: number }[];
  entries: ArchiveEntry[];
  createdAt: number;
}

const OUTCOME_COPY: Record<string, string> = {
  survived: "the fake was never caught",
  caught_named: "caught — but named the word",
  caught_wrong: "caught, and the guess missed",
};

export function ArchivePage({ id, onHome }: { id: string; onHome: () => void }) {
  const [archive, setArchive] = useState<PublishedArchive | null>(null);
  const [status, setStatus] = useState<"loading" | "ok" | "missing">("loading");

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/archives/${id}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("missing"))))
      .then((data) => {
        if (!cancelled) {
          setArchive(data as PublishedArchive);
          setStatus("ok");
        }
      })
      .catch(() => {
        if (!cancelled) setStatus("missing");
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (status !== "ok" || !archive) {
    return (
      <Screen>
        <div className="header--strip kicker" style={{ borderBottom: "3px solid var(--ink)" }}>
          <span>The archive</span>
          <span className={status === "loading" ? "pulse" : "u-red"}>
            {status === "loading" ? "Fetching…" : "Missing"}
          </span>
        </div>
        <div className="grow" style={{ display: "flex", flexDirection: "column", justifyContent: "center", gap: 16, padding: "0 22px" }}>
          {status === "missing" && (
            <>
              <div className="shout" style={{ fontSize: 40, lineHeight: 0.9 }}>
                Nothing hangs
                <br />
                here anymore
              </div>
              <div className="body-copy u-muted">
                Archives are kept for a year. This one has either lapsed or never existed.
              </div>
              <Btn variant="ink" onClick={onHome}>
                To the entrance
              </Btn>
            </>
          )}
        </div>
      </Screen>
    );
  }

  const ranked = [...archive.players].sort((a, b) => b.score - a.score);
  const winner = ranked[0];
  const date = new Date(archive.createdAt);

  return (
    <Screen>
      <div style={{ background: "var(--red)", color: "var(--cream-on-red)", padding: "22px 20px", flex: "none" }}>
        <Kicker>
          The archive ·{" "}
          {date.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}
        </Kicker>
        <div className="shout" style={{ fontSize: "clamp(30px, 9vw, 42px)", lineHeight: 0.9, letterSpacing: "-0.04em" }}>
          {archive.title}
        </div>
        {winner && (
          <div style={{ fontSize: 15, fontWeight: 600, paddingTop: 8 }}>
            {winner.name} took the gallery with {winner.score} points.
          </div>
        )}
      </div>
      <div className="grow scroll" style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 16 }}>
        {archive.entries.map((entry) => (
          <div key={entry.roundNo} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ background: "var(--paper)", border: "2px solid var(--ink)", aspectRatio: "1", position: "relative" }}>
              <svg viewBox="0 0 1000 1000" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
                <StrokePaths strokes={entry.strokes} width={20} />
              </svg>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
              <span className="shout" style={{ fontSize: 18, letterSpacing: "-0.02em" }}>
                {String(entry.roundNo).padStart(2, "0")} {entry.word}
              </span>
              <span className="small u-muted" style={{ textAlign: "right" }}>
                {entry.fakeName}: {OUTCOME_COPY[entry.outcome] ?? entry.outcome}
              </span>
            </div>
          </div>
        ))}
        <div style={{ borderTop: "3px solid var(--ink)", paddingTop: 12 }}>
          {ranked.map((p, i) => (
            <div key={`${p.name}-${i}`} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: "1px solid var(--rule)", fontSize: 14, fontWeight: 600 }}>
              <span className="u-muted" style={{ width: 20 }}>{i + 1}</span>
              <Swatch index={p.colorIndex} />
              <span style={{ flex: 1 }}>{p.name}</span>
              <span className="shout" style={{ fontSize: 16 }}>{p.score}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="footer footer--rule">
        <Btn variant="outline" onClick={onHome}>
          The Uninvited Painter — play a round
        </Btn>
      </div>
    </Screen>
  );
}
