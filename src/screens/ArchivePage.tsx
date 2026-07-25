// A published game, hanging at its permanent URL — the shared archive page
// the design left "not yet designed".

import { useEffect, useState } from "react";
import type { ArchiveEntry } from "../../shared/types";
import { StrokePaths } from "../components/CanvasBoard";
import { criticAccuracy, criticChoice } from "../lib/aiStats";
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
    let loaded = false;
    let retries = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const load = async () => {
      try {
        const response = await fetch(`/api/archives/${id}`, {
          cache: "no-store",
        });
        if (!response.ok) throw new Error("missing");
        const data = (await response.json()) as PublishedArchive;
        if (cancelled) return;
        loaded = true;
        setArchive(data);
        setStatus("ok");
        if (
          data.entries.some(
            (entry) =>
              entry.ai?.criticStatus === "pending" ||
              entry.ai?.renditionStatus === "pending",
          )
        ) {
          timer = setTimeout(load, 5000);
        }
      } catch {
        if (cancelled) return;
        if (!loaded) {
          setStatus("missing");
        } else if (retries < 6) {
          // A blip mid-poll (phone locking, flaky wifi) must not permanently
          // strand a still-pending verdict.
          retries += 1;
          timer = setTimeout(load, 5000);
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
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
  const choice = criticChoice(archive.entries);
  const accuracy = criticAccuracy(archive.entries);

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
        {(choice || accuracy.subjectTotal > 0 || accuracy.detectiveTotal > 0) && (
          <div className="ai-gallery-stats">
            {choice && (
              <div>
                <div className="kicker u-red">Luna&apos;s choice</div>
                <div className="shout" style={{ fontSize: 20 }}>
                  Round {choice.roundNo} · {choice.ai?.critic?.title ?? choice.word}
                </div>
              </div>
            )}
            <div className="small">
              {accuracy.subjectTotal > 0 &&
                `Blind guesses ${accuracy.subjectCorrect}/${accuracy.subjectTotal}`}
              {accuracy.subjectTotal > 0 && accuracy.detectiveTotal > 0 && " · "}
              {accuracy.detectiveTotal > 0 &&
                `Fake picks ${accuracy.detectiveCorrect}/${accuracy.detectiveTotal}`}
            </div>
          </div>
        )}
        {archive.entries.map((entry) => (
          <div key={entry.roundNo} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div
              className={
                entry.ai?.renditionStatus === "ready"
                  ? "published-art published-art--pair"
                  : "published-art"
              }
            >
              <figure>
                <div className="rendition-frame">
                  <svg viewBox="0 0 1000 1000">
                    <StrokePaths strokes={entry.strokes} width={20} />
                  </svg>
                </div>
                <figcaption className="kicker">What it was</figcaption>
              </figure>
              {entry.ai?.renditionStatus === "ready" && (
                <figure>
                  <img
                    src={`/api/archives/${id}/round/${entry.roundNo}/rendition.jpg`}
                    alt={`Archived AI-generated realistic rendition for round ${entry.roundNo}`}
                  />
                  <figcaption className="kicker">What it became</figcaption>
                </figure>
              )}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
              <span>
                <span className="shout" style={{ display: "block", fontSize: 18, letterSpacing: "-0.02em" }}>
                  {String(entry.roundNo).padStart(2, "0")} {entry.word}
                </span>
                {entry.ai?.critic?.title && (
                  <span className="small u-muted">
                    {entry.ai.critic.title}
                    {entry.ai.critic.rating
                      ? ` · ${entry.ai.critic.rating}/10`
                      : ""}
                  </span>
                )}
              </span>
              <span className="small u-muted" style={{ textAlign: "right" }}>
                {entry.fakeName}: {OUTCOME_COPY[entry.outcome] ?? entry.outcome}
              </span>
            </div>
            {entry.ai?.renditionStatus === "pending" && (
              <div className="note" aria-live="polite">
                Reality is still negotiating with the line work.
              </div>
            )}
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
