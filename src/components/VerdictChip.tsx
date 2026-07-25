// "Luna's verdict is in" — a way back to a result that arrived after you
// skipped ahead. Without it, advancing past a pending critic loses it for good.

import type { RoundAi } from "../../shared/types";

export function VerdictChip({
  ai,
  target,
  onOpen,
}: {
  ai: RoundAi | null | undefined;
  /** Which screen the chip returns you to. */
  target: "critic" | "rendition";
  onOpen: () => void;
}) {
  if (!ai) return null;
  const ready =
    target === "critic"
      ? ai.criticStatus === "ready" && !!ai.critic
      : ai.renditionStatus === "ready" && !!ai.renditionId;
  if (!ready) return null;

  return (
    <button className="verdict-chip" onClick={onOpen} aria-live="polite">
      <span className="verdict-chip__dot" />
      {target === "critic" ? "Luna's verdict is in" : "The rendition is ready"}
      <span className="verdict-chip__go">→</span>
    </button>
  );
}
