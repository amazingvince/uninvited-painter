import { guessMatches } from "../../shared/fuzzy";
import type {
  Player,
  RoundAi,
  RoundState,
} from "../../shared/types";
import { Btn, Screen } from "../components/ui";

type CriticSource = Pick<RoundState, "ai"> &
  Partial<Pick<RoundState, "word" | "fakeId">>;

export function criticViewModel(source: CriticSource, players: Player[]) {
  const verdict = source.ai.critic;
  const nameFor = (playerId: string | undefined) =>
    players.find((player) => player.id === playerId)?.name ??
    "A departed artist";
  return {
    status: source.ai.criticStatus,
    verdict,
    calloutName: verdict?.callout
      ? nameFor(verdict.callout.playerId)
      : undefined,
    detectiveName: verdict?.detective
      ? nameFor(verdict.detective.playerId)
      : undefined,
    subjectMatched:
      verdict?.subjectGuess && source.word
        ? guessMatches(verdict.subjectGuess, source.word)
        : undefined,
    detectiveMatched:
      verdict?.detective && source.fakeId
        ? verdict.detective.playerId === source.fakeId
        : undefined,
    detectiveCounts: false as const,
  };
}

export function CriticVerdict({
  ai,
  players,
  onNext,
}: {
  ai: RoundAi;
  players: Player[];
  onNext: () => void;
}) {
  // This screen deliberately receives no intended word, fake identity, votes,
  // or scores. Luna's blind opinion gets its own clean moment.
  const view = criticViewModel({ ai }, players);
  const verdict = view.verdict;

  return (
    <Screen tone="ink">
      <div
        className="grow scroll"
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 18,
          padding: "20px",
        }}
      >
        <div className="kicker" style={{ color: "var(--gold)" }}>
          Luna 5.6 · The critic&apos;s verdict
        </div>

        {view.status === "ready" && verdict ? (
          <>
            <div
              className="shout"
              style={{
                fontSize: 46,
                lineHeight: 0.9,
                letterSpacing: "-0.045em",
              }}
            >
              {verdict.title ?? "A suspiciously untitled work"}
            </div>
            {verdict.subjectGuess && (
              <div
                style={{
                  borderTop: "3px solid currentColor",
                  borderBottom: "3px solid currentColor",
                  padding: "14px 0",
                  display: "grid",
                  gap: 6,
                }}
              >
                <div className="kicker" style={{ color: "var(--muted-dark)" }}>
                  Luna thinks it is
                </div>
                <div className="shout" style={{ fontSize: 24 }}>
                  {verdict.subjectGuess}
                </div>
                {verdict.confidence !== undefined && (
                  <div className="small" style={{ color: "var(--muted-dark)" }}>
                    {verdict.confidence}% confidence, somehow
                  </div>
                )}
              </div>
            )}
            {verdict.rating !== undefined && (
              <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
                <span className="shout" style={{ fontSize: 54, color: "var(--gold)" }}>
                  {verdict.rating}/10
                </span>
                {verdict.ratingTag && (
                  <span className="shout" style={{ fontSize: 16 }}>
                    {verdict.ratingTag}
                  </span>
                )}
              </div>
            )}
            {verdict.review && (
              <div className="body-copy" style={{ color: "var(--cream)" }}>
                {verdict.review}
              </div>
            )}
            {verdict.callout && (
              <div style={{ borderLeft: "4px solid var(--gold)", paddingLeft: 12 }}>
                <div className="kicker" style={{ color: "var(--gold)" }}>
                  Stroke of note · {view.calloutName}
                </div>
                <div className="small" style={{ paddingTop: 5 }}>
                  {verdict.callout.text}
                </div>
              </div>
            )}
            {verdict.detective && (
              <div
                style={{
                  background: "var(--cream)",
                  color: "var(--ink)",
                  padding: 16,
                  display: "grid",
                  gap: 6,
                }}
              >
                <div className="kicker u-red">Non-binding opinion · never counts</div>
                <div className="shout" style={{ fontSize: 22 }}>
                  Luna suspects {view.detectiveName}
                </div>
                <div className="small">{verdict.detective.reason}</div>
              </div>
            )}
          </>
        ) : view.status === "pending" ? (
          <div aria-live="polite" style={{ margin: "auto 0" }}>
            <div className="shout" style={{ fontSize: 42, lineHeight: 0.9 }}>
              Luna is still deciding whether this is visionary or a workplace
              incident.
            </div>
          </div>
        ) : view.status === "unavailable" ? (
          <div aria-live="polite" style={{ margin: "auto 0" }}>
            <div className="shout" style={{ fontSize: 42, lineHeight: 0.9 }}>
              The critic has declined to defend its opinion.
            </div>
          </div>
        ) : (
          <div aria-live="polite" style={{ margin: "auto 0" }}>
            <div className="shout" style={{ fontSize: 42, lineHeight: 0.9 }}>
              No critic was invited to this exhibition.
            </div>
          </div>
        )}

        <div style={{ marginTop: "auto" }}>
          <Btn variant="red" onClick={onNext}>
            The attribution
          </Btn>
        </div>
      </div>
    </Screen>
  );
}
