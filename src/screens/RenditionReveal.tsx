import { useEffect, useState } from "react";
import type { RoundAi, Stroke } from "../../shared/types";
import { StrokePaths } from "../components/CanvasBoard";
import { Btn, Screen } from "../components/ui";

export function renditionImageUrl(renditionId: string): string {
  return `/api/ai/renditions/${encodeURIComponent(renditionId)}`;
}

export function RenditionReveal({
  ai,
  strokes,
  title,
  onNext,
}: {
  ai: RoundAi;
  strokes: Stroke[];
  title?: string;
  onNext: () => void;
}) {
  const [showRendition, setShowRendition] = useState(false);

  useEffect(() => {
    setShowRendition(false);
    if (ai.renditionStatus !== "ready" || !ai.renditionId) return;
    if (
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    ) {
      setShowRendition(true);
      return;
    }
    const timer = setTimeout(() => setShowRendition(true), 650);
    return () => clearTimeout(timer);
  }, [ai.renditionId, ai.renditionStatus]);

  const original = (
    <div className="rendition-frame">
      <svg viewBox="0 0 1000 1000" aria-label="The players' original drawing">
        <StrokePaths strokes={strokes} width={23} />
      </svg>
    </div>
  );

  return (
    <Screen>
      <div
        className="grow scroll rendition-reveal"
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 16,
          padding: "18px 20px",
        }}
      >
        <div className="kicker u-red">The reality treatment</div>
        <div className="shout" style={{ fontSize: 38, lineHeight: 0.9 }}>
          {title ?? "Untitled"} — after a brief argument with reality
        </div>

        {ai.renditionStatus === "ready" && ai.renditionId ? (
          showRendition ? (
            <div className="rendition-pair">
              <figure>
                {original}
                <figcaption className="kicker">What it was</figcaption>
              </figure>
              <figure className="rendition-reveal__result">
                <img
                  src={renditionImageUrl(ai.renditionId)}
                  alt="AI-generated realistic rendition based on the players' drawing"
                />
                <figcaption className="kicker">What it became</figcaption>
              </figure>
            </div>
          ) : (
            <div aria-live="polite" style={{ display: "grid", gap: 12 }}>
              {original}
              <div className="note">
                Reality is developing the evidence. Please avoid eye contact.
              </div>
            </div>
          )
        ) : ai.renditionStatus === "pending" ? (
          <div aria-live="polite" style={{ display: "grid", gap: 14 }}>
            {original}
            <div className="shout" style={{ fontSize: 30, lineHeight: 0.95 }}>
              Reality is still negotiating with the line work.
            </div>
          </div>
        ) : (
          <div aria-live="polite" style={{ display: "grid", gap: 14 }}>
            {original}
            <div className="shout" style={{ fontSize: 30, lineHeight: 0.95 }}>
              This masterpiece could not clear the velvet rope.
            </div>
          </div>
        )}

        <div style={{ marginTop: "auto" }}>
          <Btn variant="red" onClick={onNext}>
            Standings
          </Btn>
        </div>
      </div>
    </Screen>
  );
}
