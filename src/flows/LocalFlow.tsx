// Pass-one-phone mode. Same reducer as online; the phone travels and this flow
// inserts the hand-off ceremony between private moments.

import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  activeArtists,
  currentDrawerId,
  isGameOver,
  mustSee,
  reduce,
} from "../../shared/engine";
import { prepareRoundEvent, redrawWordEvent } from "../../shared/decks";
import { guessMatches } from "../../shared/fuzzy";
import type { GameEvent, RoomState } from "../../shared/types";
import { clearLocalGame, saveLocalGame } from "../lib/storage";
import {
  aiResultEvents,
  getLocalAiJob,
  shouldPollLocalAi,
  shouldStartLocalAi,
  startLocalAiJob,
} from "../lib/postRoundAi";
import { drawingReferencePng } from "../lib/share";
import { cueLock, cueReveal, cueRound } from "../lib/sound";
import { useWakeLock } from "../lib/useWakeLock";
import { Screen, Btn } from "../components/ui";
import { StrokePaths } from "../components/CanvasBoard";
import { RulesSheet } from "../components/RulesSheet";
import { ScreenFade } from "../components/ScreenFade";
import { Roster } from "../screens/Roster";
import { DeckSettings } from "../screens/DeckSettings";
import { HouseWords } from "../screens/HouseWords";
import { QmWord } from "../screens/QmWord";
import { HandOff, Interstitial } from "../screens/HandOff";
import { RoleCard } from "../screens/RoleCard";
import { DrawTurn } from "../screens/DrawTurn";
import { Vote } from "../screens/Vote";
import { Tally } from "../screens/Tally";
import { Guess } from "../screens/Guess";
import { CriticVerdict } from "../screens/CriticVerdict";
import { Reveal } from "../screens/Reveal";
import { RenditionReveal } from "../screens/RenditionReveal";
import { Standings } from "../screens/Standings";
import { Final } from "../screens/Final";

type RevealStep = "critic" | "attribution" | "rendition" | "standings";

export function LocalFlow({
  initial,
  onExit,
}: {
  initial: RoomState;
  onExit: () => void;
}) {
  const [state, setState] = useState<RoomState>(initial);
  const [setupStep, setSetupStep] = useState<"roster" | "decks">("roster");
  const [acks, setAcks] = useState<Record<string, boolean>>({});
  const [revealStep, setRevealStep] = useState<RevealStep>(() =>
    initial.round?.outcome !== "voided" &&
    (initial.settings.aiCritic || initial.settings.aiDetective)
      ? "critic"
      : "attribution",
  );
  const [showRules, setShowRules] = useState(false);
  const [showHouse, setShowHouse] = useState(false);
  const [peekWall, setPeekWall] = useState(false);
  const aiStarts = useRef(new Set<number>());
  const aiPollers = useRef(
    new Map<string, { roundNo: number; cancelled: boolean }>(),
  );

  useWakeLock(true); // game night — the shared phone must not doze off

  const dispatch = (event: GameEvent): boolean => {
    const result = reduce(state, event);
    if (!result.ok) {
      console.warn(event.type, result.error);
      return false;
    }
    setState(result.state);
    saveLocalGame(result.state);
    return true;
  };

  const ack = (key: string) => setAcks((a) => ({ ...a, [key]: true }));

  const round = state.round;

  const applyAiEvent = useCallback((event: GameEvent) => {
    setState((current) => {
      let result = reduce(current, event);
      // A verdict the engine rejects (e.g. it named an artist who has since
      // been dropped) must still settle the branch, or the screen sits on
      // "Luna is still deciding" forever. The DO already does this; local mode
      // used to drop the rejection on the floor.
      if (!result.ok && event.type === "RESOLVE_ROUND_CRITIC") {
        result = reduce(current, {
          type: "FAIL_ROUND_CRITIC",
          roundNo: event.roundNo,
          jobId: event.jobId,
        });
      } else if (!result.ok && event.type === "RESOLVE_ROUND_RENDITION") {
        result = reduce(current, {
          type: "FAIL_ROUND_RENDITION",
          roundNo: event.roundNo,
          jobId: event.jobId,
        });
      }
      if (!result.ok) return current;
      saveLocalGame(result.state);
      return result.state;
    });
  }, []);

  // The source upload begins as soon as drawing closes. It never waits for,
  // or changes, the human ballot.
  useEffect(() => {
    const currentRound = state.round;
    if (
      (state.phase === "lobby" || state.phase === "dealing") &&
      currentRound?.ai.jobId === null
    ) {
      aiStarts.current.delete(currentRound.roundNo);
    }
    if (!currentRound || !shouldStartLocalAi(state)) return;
    if (aiStarts.current.has(currentRound.roundNo)) return;
    aiStarts.current.add(currentRound.roundNo);

    const jobId = crypto.randomUUID();
    const started = reduce(state, {
      type: "START_ROUND_AI",
      roundNo: currentRound.roundNo,
      jobId,
    });
    if (!started.ok) return;
    setState(started.state);
    saveLocalGame(started.state);

    void (async () => {
      try {
        const png = await drawingReferencePng(currentRound.strokes);
        await startLocalAiJob(state, jobId, png);
      } catch {
        applyAiEvent({
          type: "FAIL_ROUND_CRITIC",
          roundNo: currentRound.roundNo,
          jobId,
        });
        applyAiEvent({
          type: "FAIL_ROUND_RENDITION",
          roundNo: currentRound.roundNo,
          jobId,
        });
      }
    })();
  }, [applyAiEvent, state]);

  // Jobs stay alive across later rounds. Keep polling every archived pending
  // job until both independent branches settle.
  useEffect(() => {
    const pending: Array<{ jobId: string; roundNo: number }> = [];
    if (state.round && shouldPollLocalAi(state.round.ai)) {
      pending.push({
        jobId: state.round.ai.jobId!,
        roundNo: state.round.roundNo,
      });
    }
    for (const entry of state.archive) {
      if (entry.ai && shouldPollLocalAi(entry.ai)) {
        pending.push({ jobId: entry.ai.jobId!, roundNo: entry.roundNo });
      }
    }
    const active = new Set(pending.map((job) => job.jobId));
    for (const [jobId, poller] of aiPollers.current) {
      if (!active.has(jobId)) {
        poller.cancelled = true;
        aiPollers.current.delete(jobId);
      }
    }

    for (const job of pending) {
      if (aiPollers.current.has(job.jobId)) continue;
      const poller = { roundNo: job.roundNo, cancelled: false };
      aiPollers.current.set(job.jobId, poller);
      void (async () => {
        const delays = [1000, 1500, 2500, 4000, 5000];
        // A workflow that died mid-flight must not leave Luna "deciding"
        // forever — after this long the verdict is declared lost.
        const giveUpAt = Date.now() + 4 * 60_000;
        let attempt = 0;
        try {
          while (!poller.cancelled) {
            const delay = delays[Math.min(attempt, delays.length - 1)];
            await new Promise((resolve) => setTimeout(resolve, delay));
            if (poller.cancelled) return;
            if (Date.now() > giveUpAt) {
              applyAiEvent({
                type: "FAIL_ROUND_CRITIC",
                roundNo: poller.roundNo,
                jobId: job.jobId,
              });
              applyAiEvent({
                type: "FAIL_ROUND_RENDITION",
                roundNo: poller.roundNo,
                jobId: job.jobId,
              });
              return;
            }
            attempt += 1;
            try {
              const result = await getLocalAiJob(job.jobId);
              if (
                result.jobId !== job.jobId ||
                result.roundNo !== poller.roundNo
              ) {
                continue;
              }
              for (const event of aiResultEvents(result)) applyAiEvent(event);
              if (
                result.criticStatus !== "pending" &&
                result.renditionStatus !== "pending"
              ) {
                return;
              }
            } catch {
              // The Workflow may not have published yet; the next bounded poll
              // continues without touching official play.
            }
          }
        } finally {
          if (aiPollers.current.get(job.jobId) === poller) {
            aiPollers.current.delete(job.jobId);
          }
        }
      })();
    }
  }, [applyAiEvent, state]);

  useEffect(
    () => () => {
      for (const poller of aiPollers.current.values()) {
        poller.cancelled = true;
      }
      aiPollers.current.clear();
    },
    [],
  );

  // Reset per-round sub-steps when a new round starts.
  useEffect(() => {
    setRevealStep(
      round?.outcome !== "voided" &&
        (state.settings.aiCritic || state.settings.aiDetective)
        ? "critic"
        : "attribution",
    );
  }, [
    round?.outcome,
    round?.roundNo,
    state.settings.aiCritic,
    state.settings.aiDetective,
  ]);

  // Phase cues — a pulse when cards go out, a stamp at the reveal.
  const prevPhase = useRef(state.phase);
  useEffect(() => {
    if (state.phase !== prevPhase.current) {
      if (state.phase === "dealing") cueRound();
      if (state.phase === "reveal") cueReveal();
      prevPhase.current = state.phase;
    }
  }, [state.phase]);

  // Local guess timer — the clock only runs once the fake actually holds the
  // phone (the tally/hand-off screens come first), and the reducer's deadline
  // is restarted at that moment via EXTEND_GUESS.
  const guessHandedOver = round ? !!acks[`tally-${round.roundNo}`] : false;
  useEffect(() => {
    if (state.phase !== "guessing" || !round?.guessDeadline || !guessHandedOver) return;
    const id = setInterval(() => {
      if (Date.now() >= (round.guessDeadline ?? 0)) {
        dispatch({ type: "GUESS_TIMEOUT", now: Date.now() });
      }
    }, 400);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase, round?.guessDeadline, guessHandedOver]);

  const rules = showRules ? (
    <RulesSheet onClose={() => setShowRules(false)} settings={state.settings} />
  ) : null;

  const wallPeek = peekWall && round && (
    <div className="overlay" style={{ background: "var(--paper)", pointerEvents: "none" }}>
      <svg viewBox="0 0 1000 1000" style={{ width: "100%", aspectRatio: "1", marginTop: "20vh" }}>
        <StrokePaths strokes={round.strokes} />
      </svg>
    </div>
  );

  let body: ReactNode = null;

  if (state.phase === "lobby") {
    body =
      setupStep === "roster" ? (
        <Roster
          players={state.players}
          onAdd={(name, colorIndex) => {
            const result = reduce(state, {
              type: "ADD_PLAYER",
              player: { id: crypto.randomUUID(), name, colorIndex },
            });
            if (!result.ok) return result.error;
            setState(result.state);
            saveLocalGame(result.state);
            return null;
          }}
          onRemove={(id) => dispatch({ type: "REMOVE_PLAYER", playerId: id })}
          onReorder={(order) => dispatch({ type: "REORDER_PLAYERS", order })}
          onBack={onExit}
          onNext={() => setSetupStep("decks")}
        />
      ) : (
        <DeckSettings
          settings={state.settings}
          houseWordCount={state.customWords.length}
          onHouseWords={() => setShowHouse(true)}
          onChange={(patch) => dispatch({ type: "SET_SETTINGS", settings: patch })}
          onBack={() => setSetupStep("roster")}
          onStart={() => {
            if (dispatch(prepareRoundEvent(state))) setAcks({});
          }}
        />
      );
  } else if (state.phase === "closed") {
    // CLOSE_GAME clears the round, so this must come before the !round guard.
    body = (
      <Final
        players={state.players}
        archive={state.archive}
        totalRounds={state.settings.rounds}
        onAgain={() => {
          if (dispatch({ type: "PLAY_AGAIN" })) {
            setAcks({});
            setSetupStep("roster");
          }
        }}
      />
    );
  } else if (!round) {
    body = null;
  } else if (state.phase === "dealing") {
    const qm = round.qmId ? state.players.find((p) => p.id === round.qmId) : null;
    if (!round.dealt && qm) {
      const key = `qm-${round.roundNo}`;
      body = !acks[key] ? (
        <Interstitial
          kicker={`Round ${round.roundNo} / ${state.settings.rounds}`}
          right="Question master"
          avatar={qm.name.slice(0, 1).toUpperCase()}
          title={
            <>
              Hand to
              <br />
              {qm.name}
            </>
          }
          body="They set the word this round. Everyone else looks away."
          buttonLabel={`${qm.name} has it`}
          onButton={() => ack(key)}
          footer={
            <>
              <span />
              <button className="kicker u-muted" style={{ letterSpacing: "0.1em" }} onClick={() => setShowRules(true)}>
                Rules
              </button>
            </>
          }
        />
      ) : (
        <QmWord
          qmName={qm.name}
          roundNo={round.roundNo}
          totalRounds={state.settings.rounds}
          category={round.category}
          word={round.word}
          artists={round.turnOrder.length}
          onRedraw={() => dispatch(redrawWordEvent(state))}
          onDeal={() => dispatch({ type: "DEAL", now: Date.now() })}
        />
      );
    } else {
      const order = mustSee(round);
      const nextSeer = order.find((id) => !round.seen.includes(id));
      const player = state.players.find((p) => p.id === nextSeer);
      if (player) {
        body = (
          <HandOff
            key={player.id}
            kicker="Dealing cards"
            right={`${round.seen.length + 1} of ${order.length}`}
            name={player.name}
            hint="Everyone else looks away. Nothing shows until their thumb is on the glass."
            progress={{ done: round.seen.length, total: order.length }}
            card={() => (
              <RoleCard
                fake={player.id === round.fakeId}
                playerName={player.name}
                category={round.category}
                word={round.word}
                colorIndex={player.colorIndex}
              />
            )}
            onSeen={() => dispatch({ type: "MARK_SEEN", playerId: player.id, now: Date.now() })}
          />
        );
      }
    }
  } else if (state.phase === "drawing") {
    const drawerId = currentDrawerId(state);
    const drawer = state.players.find((p) => p.id === drawerId);
    if (drawer) {
      const key = `turn-${round.roundNo}-${round.turnIndex}`;
      // Which pass is this? Count the drawer's completed turns in the schedule.
      const pass =
        round.schedule.slice(0, round.turnIndex).filter((id) => id === drawer.id).length + 1;
      if (!acks[key]) {
        body = (
          <Interstitial
            kicker={round.turnIndex === 0 ? "Cards dealt" : "Stroke committed"}
            right={`Pass ${pass} · ${round.turnIndex + 1} of ${round.schedule.length}`}
            avatar={drawer.name.slice(0, 1).toUpperCase()}
            title={
              <>
                Pass to
                <br />
                {drawer.name}
              </>
            }
            body={
              round.turnIndex === 0
                ? "Face down while it travels. Their word is already on the card — no re-deal."
                : "Face down while it travels. The word is already on the card — no re-deal."
            }
            buttonLabel={`${drawer.name} has it`}
            onButton={() => ack(key)}
            footer={
              <>
                <span
                  onPointerDown={() => setPeekWall(true)}
                  onPointerUp={() => setPeekWall(false)}
                  onPointerLeave={() => setPeekWall(false)}
                >
                  Hold to peek at the wall
                </span>
                <button className="kicker u-muted" style={{ letterSpacing: "0.1em" }} onClick={() => setShowRules(true)}>
                  Rules
                </button>
              </>
            }
          />
        );
      } else {
        const isFake = drawer.id === round.fakeId;
        body = (
          <DrawTurn
            key={key}
            word={isFake ? null : round.word}
            category={round.category}
            colorIndex={drawer.colorIndex}
            strokes={round.strokes}
            strokeNo={round.turnIndex + 1}
            strokeTotal={round.schedule.length}
            youLabel={drawer.name}
            penMode={state.settings.penMode}
            inkLimit={state.settings.inkLimit}
            onCommit={(points, breaks) =>
              dispatch({ type: "COMMIT_STROKE", playerId: drawer.id, points, breaks, now: Date.now() })
            }
          />
        );
      }
    }
  } else if (state.phase === "voting") {
    const voters = activeArtists(round);
    const nextVoter = voters.find((id) => round.votes[id] === undefined);
    const voter = state.players.find((p) => p.id === nextVoter);
    if (voter) {
      const key = `vote-${round.roundNo}-${voter.id}`;
      body = !acks[key] ? (
        <Interstitial
          kicker="Secret ballot"
          right={`${Object.keys(round.votes).length + 1} of ${voters.length}`}
          avatar={voter.name.slice(0, 1).toUpperCase()}
          title={
            <>
              Hand to
              <br />
              {voter.name}
            </>
          }
          body="Both passes are on the wall. Time to name the fraud — quietly."
          buttonLabel={`${voter.name} has it`}
          onButton={() => ack(key)}
          footer={
            <>
              <span
                onPointerDown={() => setPeekWall(true)}
                onPointerUp={() => setPeekWall(false)}
                onPointerLeave={() => setPeekWall(false)}
              >
                Hold to peek at the wall
              </span>
              <button className="kicker u-muted" style={{ letterSpacing: "0.1em" }} onClick={() => setShowRules(true)}>
                Rules
              </button>
            </>
          }
        />
      ) : (
        <Vote
          voterId={voter.id}
          voterName={voter.name}
          candidates={voters}
          qmId={round.qmId}
          players={state.players}
          strokes={round.strokes}
          votersIn={Object.keys(round.votes)}
          onLock={(targetId) => {
            cueLock();
            dispatch({ type: "CAST_VOTE", voterId: voter.id, targetId, now: Date.now() });
          }}
        />
      );
    }
  } else if (state.phase === "guessing") {
    const fake = state.players.find((p) => p.id === round.fakeId)!;
    const key = `tally-${round.roundNo}`;
    body = !acks[key] ? (
      <Tally
        votes={round.votes}
        players={state.players}
        accusedId={round.accusedId}
        fakeWasAccused={true}
        buttonLabel={`Hand ${fake.name} the phone`}
        onContinue={() => {
          // Their 30 seconds start when they take the phone, not at the tally.
          dispatch({ type: "EXTEND_GUESS", now: Date.now() });
          ack(key);
        }}
      />
    ) : (
      <Guess
        category={round.category}
        strokes={round.strokes}
        deadline={round.guessDeadline}
        onSubmit={(text) =>
          dispatch({
            type: "SUBMIT_GUESS",
            playerId: round.fakeId,
            text,
            matched: guessMatches(text, round.word),
          })
        }
      />
    );
  } else if (state.phase === "reveal") {
    const voided = round.outcome === "voided";
    const aiExhibition =
      !voided && (state.settings.aiCritic || state.settings.aiDetective);
    // isGameOver, not a rounds comparison — score-to-10 games end on points.
    const isLastRound = isGameOver(state);
    const tallyKey = `tally-${round.roundNo}`;
    // Derive rather than trust the stored step: a voided round lands one frame
    // before the effect can correct it.
    if (revealStep === "critic" && !voided) {
      body = (
        <CriticVerdict
          ai={round.ai}
          players={state.players}
          onNext={() => setRevealStep("attribution")}
        />
      );
    } else if (
      revealStep === "attribution" &&
      !voided &&
      round.outcome === "survived" &&
      !acks[tallyKey] &&
      Object.keys(round.votes).length > 0
    ) {
      body = (
        <Tally
          votes={round.votes}
          players={state.players}
          accusedId={round.accusedId}
          fakeWasAccused={false}
          buttonLabel="The attribution"
          onContinue={() => ack(tallyKey)}
        />
      );
    } else if (revealStep === "attribution") {
      body = (
        <Reveal
          round={round}
          players={state.players}
          totalRounds={state.settings.rounds}
          isLastRound={isLastRound}
          nextLabel={
            voided
              ? "Re-deal the round"
              : aiExhibition
                ? "What it became"
                : "Standings"
          }
          onNext={() => {
            if (voided) {
              if (dispatch(prepareRoundEvent(state))) setAcks({});
            } else {
              setRevealStep(aiExhibition ? "rendition" : "standings");
            }
          }}
        />
      );
    } else if (revealStep === "rendition") {
      body = (
        <RenditionReveal
          ai={round.ai}
          strokes={round.strokes}
          title={round.ai.critic?.title}
          onNext={() => setRevealStep("standings")}
        />
      );
    } else {
      body = (
        <Standings
          players={state.players}
          roundsPlayed={state.roundsPlayed}
          totalRounds={state.settings.rounds}
            scoreMode={state.settings.winMode === "score10"}
          nextLabel={isLastRound ? "Close the exhibition" : `Round ${state.roundsPlayed + 1}`}
          onNext={() => {
            if (isLastRound) {
              dispatch({ type: "CLOSE_GAME" });
            } else if (dispatch(prepareRoundEvent(state))) {
              setAcks({});
            }
          }}
        />
      );
    }
  }

  if (!body) {
    body = (
      <Screen>
        <div className="grow" style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <div className="btn-stack" style={{ width: "100%" }}>
            <div className="note u-center">Something got out of order.</div>
            <Btn
              variant="outline"
              onClick={() => {
                clearLocalGame();
                onExit();
              }}
            >
              Back to the entrance
            </Btn>
          </div>
        </div>
      </Screen>
    );
  }

  const screenId = (() => {
    switch (state.phase) {
      case "lobby":
        return `lobby:${setupStep}`;
      case "closed":
        return "closed";
      case "dealing": {
        if (!round) return "x";
        if (!round.dealt && round.qmId) {
          return acks[`qm-${round.roundNo}`] ? `qmword:${round.roundNo}` : `qmhand:${round.roundNo}`;
        }
        const next = mustSee(round).find((id) => !round.seen.includes(id));
        return `dealcard:${round.roundNo}:${next ?? "done"}`;
      }
      case "drawing":
        return round
          ? `turn:${round.roundNo}:${round.turnIndex}:${acks[`turn-${round.roundNo}-${round.turnIndex}`] ? "draw" : "pass"}`
          : "x";
      case "voting": {
        if (!round) return "x";
        const voters = activeArtists(round);
        const next = voters.find((id) => round.votes[id] === undefined);
        return `vote:${round.roundNo}:${next ?? "done"}:${
          next && acks[`vote-${round.roundNo}-${next}`] ? "ballot" : "hand"
        }`;
      }
      case "guessing":
        return round ? `guess:${round.roundNo}:${acks[`tally-${round.roundNo}`] ? "input" : "tally"}` : "x";
      case "reveal":
        return round ? `reveal:${round.roundNo}:${revealStep}:${round.outcome ?? ""}` : "x";
    }
  })();
  const flood =
    screenId.startsWith("qmword") ||
    screenId.startsWith("dealcard") ||
    (screenId.startsWith("guess:") && screenId.endsWith(":input"));

  return (
    <>
      <ScreenFade id={screenId} flood={flood}>
        {body}
      </ScreenFade>
      {wallPeek}
      {showHouse && (
        <div className="overlay">
          <HouseWords
            ownWords={state.customWords.map((w) => w.word)}
            totalCount={state.customWords.length}
            note="One phone, no secrets from the writer: whoever types a word will recognise it on the wall. Take turns adding a few each — the game never deals a round you can spoil on purpose."
            onAdd={(words) => dispatch({ type: "ADD_HOUSE_WORDS", playerId: "", words })}
            onRemove={(word) => dispatch({ type: "REMOVE_HOUSE_WORD", playerId: "", word })}
            onBack={() => setShowHouse(false)}
          />
        </div>
      )}
      {rules}
    </>
  );
}
