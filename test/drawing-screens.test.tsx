import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Player, RoundState } from "../shared/types";
import { DrawTurn } from "../src/screens/DrawTurn";
import { Reveal } from "../src/screens/Reveal";
import { Spectate } from "../src/screens/Spectate";
import { Vote } from "../src/screens/Vote";

describe("drawing screen feedback", () => {
  it("keeps the fake artist's word unknown and labels their active canvas", () => {
    const markup = renderToStaticMarkup(
      <DrawTurn
        word={null}
        category="Animals"
        colorIndex={0}
        strokes={[]}
        strokeNo={2}
        strokeTotal={10}
        onCommit={() => undefined}
      />,
    );

    expect(markup).toContain("Category · Animals · word unknown");
    expect(markup).not.toContain("???");
    expect(markup).toContain('role="application"');
    expect(markup).toContain(
      'aria-label="Drawing canvas. Your stroke, 2 of 10."',
    );
    expect(markup.match(/aria-live="polite"/g)).toHaveLength(1);
  });

  it("labels the spectator canvas with the active artist and progress", () => {
    const markup = renderToStaticMarkup(
      <Spectate
        kicker="Pass 1"
        drawerName="Maya"
        strokes={[]}
        chips={[]}
        strokeNo={4}
        strokeTotal={10}
      />,
    );

    expect(markup).toContain('role="img"');
    expect(markup).toContain(
      'aria-label="Live drawing canvas. Maya is drawing, stroke 4 of 10."',
    );
  });

  it("explains how the finished voting canvas responds to artist selection", () => {
    const markup = renderToStaticMarkup(
      <Vote
        voterId="maya"
        candidates={[]}
        qmId={null}
        players={[]}
        strokes={[]}
        votersIn={[]}
        onLock={() => undefined}
      />,
    );

    expect(markup).toContain(
      'aria-label="Finished drawing. Enlarge drawing."',
    );
    expect(markup).toContain('aria-expanded="false"');
  });

  it("names the finished round drawing in the reveal", () => {
    const players: Player[] = [
      {
        id: "maya",
        name: "Maya",
        colorIndex: 0,
        score: 0,
        connected: true,
      },
    ];
    const round: RoundState = {
      roundNo: 2,
      word: "Otter",
      category: "Animals",
      qmId: null,
      fakeId: "maya",
      turnOrder: ["maya"],
      schedule: ["maya"],
      turnIndex: 1,
      dealt: true,
      seen: ["maya"],
      strokes: [],
      votes: {},
      droppedIds: [],
      accusedId: null,
      guess: null,
      outcome: "survived",
      scoreDelta: { maya: 0 },
      guessDeadline: null,
      turnDeadline: null,
      ai: {
        jobId: null,
        criticStatus: "idle",
        critic: null,
        renditionStatus: "idle",
        renditionId: null,
      },
    };
    const markup = renderToStaticMarkup(
      <Reveal
        round={round}
        players={players}
        nextLabel="Standings"
      />,
    );

    expect(markup).toContain('role="img"');
    expect(markup).toContain('aria-label="Finished round 2 drawing."');
  });
});
