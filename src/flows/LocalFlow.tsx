// Pass-one-phone mode. Same reducer as online; the phone travels and this flow
// inserts the hand-off ceremony between private moments.

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import {
  activeArtists,
  currentDrawerId,
  mustSee,
  reduce,
} from "../../shared/engine";
import { prepareRoundEvent, redrawWordEvent } from "../../shared/decks";
import { guessMatches } from "../../shared/fuzzy";
import type { GameEvent, RoomState } from "../../shared/types";
import { clearLocalGame, saveLocalGame } from "../lib/storage";
import { Screen, Btn } from "../components/ui";
import { StrokePaths } from "../components/CanvasBoard";
import { RulesSheet } from "../components/RulesSheet";
import { Roster } from "../screens/Roster";
import { DeckSettings } from "../screens/DeckSettings";
import { QmWord } from "../screens/QmWord";
import { HandOff, Interstitial } from "../screens/HandOff";
import { RoleCard } from "../screens/RoleCard";
import { DrawTurn } from "../screens/DrawTurn";
import { Vote } from "../screens/Vote";
import { Tally } from "../screens/Tally";
import { Guess } from "../screens/Guess";
import { Reveal } from "../screens/Reveal";
import { Standings } from "../screens/Standings";
import { Final } from "../screens/Final";

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
  const [revealStep, setRevealStep] = useState<"reveal" | "standings">("reveal");
  const [showRules, setShowRules] = useState(false);
  const [peekWall, setPeekWall] = useState(false);

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

  // Reset per-round sub-steps when a new round starts.
  useEffect(() => {
    setRevealStep("reveal");
  }, [round?.roundNo, round?.outcome]);

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

  const rules = showRules ? <RulesSheet onClose={() => setShowRules(false)} /> : null;

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
          onDeal={() => dispatch({ type: "DEAL" })}
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
            onSeen={() => dispatch({ type: "MARK_SEEN", playerId: player.id })}
          />
        );
      }
    }
  } else if (state.phase === "drawing") {
    const drawerId = currentDrawerId(state);
    const drawer = state.players.find((p) => p.id === drawerId);
    if (drawer) {
      const key = `turn-${round.roundNo}-${round.turnIndex}`;
      const pass = round.turnIndex < round.turnOrder.length ? 1 : 2;
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
            onCommit={(points) =>
              dispatch({ type: "COMMIT_STROKE", playerId: drawer.id, points })
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
          onLock={(targetId) =>
            dispatch({ type: "CAST_VOTE", voterId: voter.id, targetId, now: Date.now() })
          }
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
    const isLastRound = state.roundsPlayed >= state.settings.rounds;
    const tallyKey = `tally-${round.roundNo}`;
    if (!voided && round.outcome === "survived" && !acks[tallyKey] && Object.keys(round.votes).length > 0) {
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
    } else if (revealStep === "reveal") {
      body = (
        <Reveal
          round={round}
          players={state.players}
          totalRounds={state.settings.rounds}
          isLastRound={isLastRound}
          nextLabel={voided ? "Re-deal the round" : "Standings"}
          onNext={() => {
            if (voided) {
              if (dispatch(prepareRoundEvent(state))) setAcks({});
            } else {
              setRevealStep("standings");
            }
          }}
        />
      );
    } else {
      body = (
        <Standings
          players={state.players}
          roundsPlayed={state.roundsPlayed}
          totalRounds={state.settings.rounds}
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

  return (
    <>
      {body}
      {wallPeek}
      {rules}
    </>
  );
}
