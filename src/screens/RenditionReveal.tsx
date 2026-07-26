import { useEffect, useRef, useState } from "react";
import type { RoundAi, Stroke } from "../../shared/types";
import { StrokePaths } from "../components/CanvasBoard";
import { cueUnveil } from "../lib/sound";
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
  const [imageFailed, setImageFailed] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const unveiledFor = useRef<string | null>(null);
  const imageUrl = ai.renditionId
    ? `${renditionImageUrl(ai.renditionId)}${retryKey === 0 ? "" : `?retry=${retryKey}`}`
    : "";

  // Decode before unveiling: the wipe should reveal a picture, not a blank
  // frame that pops in a beat later.
  useEffect(() => {
    setShowRendition(false);
    setImageFailed(false);
    if (ai.renditionStatus !== "ready" || !ai.renditionId) return;
    let cancelled = false;
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const started = Date.now();

    const image = new Image();
    image.src = imageUrl;
    void image
      .decode()
      .then(() => {
        if (cancelled) return;
        const wait = reduced ? 0 : Math.max(0, 650 - (Date.now() - started));
        setTimeout(() => {
          if (cancelled) return;
          setShowRendition(true);
          if (!reduced && unveiledFor.current !== ai.renditionId) {
            unveiledFor.current = ai.renditionId;
            cueUnveil();
          }
        }, wait);
      })
      .catch(() => {
        if (!cancelled) setImageFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, [ai.renditionId, ai.renditionStatus, imageUrl, retryKey]);

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
        aria-busy={ai.renditionStatus === "pending"}
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 16,
          padding: "18px 20px",
        }}
      >
        <div className="kicker u-red">The reality treatment</div>
        <div
          className="shout"
          style={{
            fontSize: (title?.length ?? 0) > 38 ? "clamp(18px, 6vw, 24px)" : "clamp(24px, 8vw, 34px)",
            lineHeight: 0.95,
            overflowWrap: "anywhere",
          }}
        >
          {title ?? "Untitled"}
        </div>
        {/* The variable-length title shouldn't drag the joke line with it. */}
        <div className="note" style={{ marginTop: -8 }}>
          After a brief argument with reality.
        </div>

        {ai.renditionStatus === "ready" && ai.renditionId && !imageFailed ? (
          showRendition ? (
            <div className="rendition-pair rendition-pair--unveil" aria-live="polite">
              <figure>
                {original}
                <figcaption className="kicker">What it was</figcaption>
              </figure>
              <figure className="rendition-reveal__result" style={{ position: "relative" }}>
                <img
                  src={imageUrl}
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
        ) : ai.renditionStatus === "ready" && ai.renditionId && imageFailed ? (
          <div aria-live="polite" style={{ display: "grid", gap: 14 }}>
            {original}
            <div className="shout" style={{ fontSize: 30, lineHeight: 0.95 }}>
              The image did not make it through the frame.
            </div>
            <Btn
              variant="outline"
              onClick={() => {
                setImageFailed(false);
                setRetryKey((key) => key + 1);
              }}
            >
              Try image again
            </Btn>
          </div>
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
            {ai.renditionStatus === "pending" ? "Skip ahead — standings" : "Standings"}
          </Btn>
        </div>
      </div>
    </Screen>
  );
}
