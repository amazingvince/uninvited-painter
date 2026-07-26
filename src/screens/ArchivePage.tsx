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

type ArchiveLoadStatus = "loading" | "ok" | "missing" | "error";

class MissingArchiveError extends Error {}

const OUTCOME_COPY: Record<string, string> = {
  survived: "the fake was never caught",
  caught_named: "caught — but named the word",
  caught_wrong: "caught, and the guess missed",
};

export function ArchivePage({ id, onHome }: { id: string; onHome: () => void }) {
  const [archive, setArchive] = useState<PublishedArchive | null>(null);
  const [status, setStatus] = useState<ArchiveLoadStatus>("loading");
  const [retryToken, setRetryToken] = useState(0);

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
        if (!response.ok) {
          if (response.status === 404) throw new MissingArchiveError();
          throw new Error(`archive request failed: ${response.status}`);
        }
        const data = (await response.json()) as PublishedArchive;
        if (cancelled) return;
        loaded = true;
        retries = 0;
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
      } catch (error) {
        if (cancelled) return;
        if (!loaded) {
          setStatus(error instanceof MissingArchiveError ? "missing" : "error");
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
  }, [id, retryToken]);

  const retry = () => {
    setStatus("loading");
    setRetryToken((token) => token + 1);
  };

  if (status !== "ok" || !archive) {
    return (
      <Screen>
        <div className="header--strip kicker" style={{ borderBottom: "3px solid var(--ink)" }}>
          <span>The archive</span>
          <span className={status === "loading" ? "pulse" : "u-red"}>
            {status === "loading"
              ? "Fetching…"
              : status === "missing"
                ? "Missing"
                : "Try again"}
          </span>
        </div>
        <div className="grow" style={{ display: "flex", flexDirection: "column", justifyContent: "center", gap: 16, padding: "0 22px" }}>
          {status === "loading" && (
            // A shared link opening onto a blank cream screen reads as broken.
            <>
              <div className="shout pulse" style={{ fontSize: 40, lineHeight: 0.9 }}>
                Unlocking
                <br />
                the gallery
              </div>
              <div className="body-copy u-muted">Hanging the pictures back up.</div>
            </>
          )}
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
          {status === "error" && (
            <>
              <div className="shout" style={{ fontSize: 40, lineHeight: 0.9 }}>
                Temporary problem
              </div>
              <div className="body-copy u-muted">
                The archive could not be reached. Check your connection and try
                again.
              </div>
              <Btn variant="ink" onClick={retry}>
                Retry
              </Btn>
              <Btn variant="outline" onClick={onHome}>
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
  const winners = ranked.filter((player) => player.score === winner?.score);
  const rankFor = (player: PublishedArchive["players"][number]): number =>
    ranked.findIndex((candidate) => candidate.score === player.score) + 1;
  const date = new Date(archive.createdAt);
  const choice = criticChoice(archive.entries);
  const accuracy = criticAccuracy(archive.entries);

  return (
    <Screen>
      <div className="gallery-header">
        <Kicker>
          The archive ·{" "}
          {date.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}
        </Kicker>
        <div className="shout gallery-title gallery-title--published">
          {archive.title}
        </div>
        {winner && (
          <div className="gallery-summary">
            {winners.length > 1
              ? `${winners.length}-way tie at ${winner.score} points.`
              : `${winner.name} took the gallery with ${winner.score} points.`}
          </div>
        )}
      </div>
      <div className="screen-scroll archive-scroll archive-scroll--published">
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
          <div key={entry.roundNo} className="archive-entry">
            {/* Only the drawing travels. Renditions are generated from a
                bitmap a player uploaded, which the room never checks against
                the real strokes, so they stay off public pages. */}
            <div className="published-art">
              <figure>
                <div className="rendition-frame">
                  <svg viewBox="0 0 1000 1000">
                    <StrokePaths strokes={entry.strokes} width={20} />
                  </svg>
                </div>
                <figcaption className="kicker">What it was</figcaption>
              </figure>
            </div>
            <div className="archive-entry-meta">
              <span>
                <span className="shout archive-entry-title">
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
              <span className="small u-muted archive-entry-outcome">
                {entry.fakeName}: {OUTCOME_COPY[entry.outcome] ?? entry.outcome}
              </span>
            </div>
          </div>
        ))}
        <div className="score-list score-list--ruled">
          {ranked.map((p, i) => {
            const rank = rankFor(p);
            return (
              <div key={`${p.name}-${i}`} className="score-row">
                <span
                  className={`score-rank ${
                    rank === 1 ? "score-rank--leader" : ""
                  }`}
                >
                  {rank}
                </span>
                <Swatch index={p.colorIndex} />
                <span className="score-player">
                  {p.name}
                  {rank === 1 && <span className="score-status">Winner</span>}
                </span>
                <span className="shout score-value">{p.score}</span>
              </div>
            );
          })}
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
