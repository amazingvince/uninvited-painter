// Online mode. Room code + link, every phone draws on the same canvas.
// Target: link tap → drawing in under 10 seconds.

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  activeArtists,
  drawerOf,
  isGameOver,
  mustSee,
  passOf,
} from "../../shared/engine";
import type { PublicRoundState } from "../../shared/protocol";
import { useOnlineRoom } from "../game/onlineClient";
import { useGameCues } from "../lib/cues";
import {
  PostRoundAiUploadError,
  uploadOnlineAiSource,
} from "../lib/postRoundAi";
import { drawingReferencePng } from "../lib/share";
import { cueLock } from "../lib/sound";
import { useWakeLock } from "../lib/useWakeLock";
import { Screen, Btn, Kicker } from "../components/ui";
import { HoldToReveal } from "../components/HoldToReveal";
import { RulesSheet } from "../components/RulesSheet";
import { ScreenFade } from "../components/ScreenFade";
import { JoinerSetup } from "../screens/JoinerSetup";
import { HostLobby } from "../screens/HostLobby";
import { HouseWords } from "../screens/HouseWords";
import { QmWord } from "../screens/QmWord";
import { RoleCard } from "../screens/RoleCard";
import { Spectate, turnChips } from "../screens/Spectate";
import { DrawTurn } from "../screens/DrawTurn";
import { Vote } from "../screens/Vote";
import { Tally } from "../screens/Tally";
import { Guess, GuessWait } from "../screens/Guess";
import { CriticVerdict } from "../screens/CriticVerdict";
import { Reveal } from "../screens/Reveal";
import { RenditionReveal } from "../screens/RenditionReveal";
import { Standings } from "../screens/Standings";
import { Final } from "../screens/Final";
import { DisconnectOverlay, ReconnectingBanner } from "../screens/Disconnect";
import { VerdictChip } from "../components/VerdictChip";
import { useRevealSequence } from "../lib/revealSequence";

function Waiting({
  kicker,
  title,
  body,
  tone = "cream",
}: {
  kicker: string;
  title: ReactNode;
  body?: string;
  tone?: "cream" | "ink";
}) {
  return (
    <Screen tone={tone}>
      <div className="header--strip kicker" style={{ borderBottom: "3px solid currentColor" }}>
        <span>{kicker}</span>
        <span className="pulse">· · ·</span>
      </div>
      <div className="grow" style={{ display: "flex", flexDirection: "column", justifyContent: "center", gap: 18, padding: "0 22px" }}>
        <div className="shout" style={{ fontSize: 40, lineHeight: 0.88, letterSpacing: "-0.04em" }}>
          {title}
        </div>
        {body && (
          <div className="body-copy" style={{ color: tone === "ink" ? "var(--muted-dark)" : "var(--muted)" }}>
            {body}
          </div>
        )}
      </div>
    </Screen>
  );
}

export function OnlineFlow({
  code,
  watch = false,
  onExit,
}: {
  code: string;
  watch?: boolean;
  onExit: () => void;
}) {
  const room = useOnlineRoom(code, watch);
  const [showRules, setShowRules] = useState(false);
  const [showHouse, setShowHouse] = useState(false);
  const [peekCard, setPeekCard] = useState(false);
  const [tallySeen, setTallySeen] = useState<number>(0); // roundNo whose tally was dismissed
  const [aiRetryTick, setAiRetryTick] = useState(0);
  const aiUploadAttempts = useRef(new Map<number, number>());
  const aiUploadComplete = useRef(new Set<number>());
  const aiUploadInFlight = useRef(new Set<number>());
  const aiRetryTimers = useRef(
    new Map<number, ReturnType<typeof setTimeout>>(),
  );

  const { state, you } = room;
  const round = state?.round ?? null;

  useWakeLock(state !== null && room.connected);
  useGameCues({
    phase: state?.phase ?? null,
    yourTurn:
      !watch &&
      state?.phase === "drawing" &&
      (round ? drawerOf(round) : null) === you?.playerId,
    cardWaiting:
      !watch &&
      state?.phase === "dealing" &&
      !!round?.dealt &&
      (you?.role === "artist" || you?.role === "fake") &&
      !round.seen.includes(you?.playerId ?? ""),
  });

  const reveal = useRevealSequence({
    outcome: round?.outcome,
    roundNo: round?.roundNo,
    settings: state?.settings,
  });

  // A re-dealt (voided) round keeps its round number — the tally gate must
  // re-arm whenever fresh cards go out.
  useEffect(() => {
    if (state?.phase === "dealing" || state?.phase === "lobby") setTallySeen(0);
  }, [state?.phase]);

  // The round opening while someone is mid-edit must not trap them in the
  // house-words editor (it's lobby-only).
  useEffect(() => {
    if (state && state.phase !== "lobby") setShowHouse(false);
  }, [state?.phase]);

  // Every seated artist may make the same idempotent attempt as voting opens;
  // the room serializes them and starts exactly one Workflow.
  useEffect(() => {
    if (state?.phase === "lobby") {
      aiUploadAttempts.current.clear();
      aiUploadComplete.current.clear();
      aiUploadInFlight.current.clear();
      for (const timer of aiRetryTimers.current.values()) clearTimeout(timer);
      aiRetryTimers.current.clear();
      return;
    }
    if (state?.phase === "dealing" && round?.ai.jobId === null) {
      aiUploadAttempts.current.delete(round.roundNo);
      aiUploadComplete.current.delete(round.roundNo);
      aiUploadInFlight.current.delete(round.roundNo);
      const timer = aiRetryTimers.current.get(round.roundNo);
      if (timer) clearTimeout(timer);
      aiRetryTimers.current.delete(round.roundNo);
    }
    if (
      watch ||
      !room.joined ||
      !state ||
      state.phase !== "voting" ||
      !round ||
      !you?.playerId ||
      (!state.settings.aiCritic && !state.settings.aiDetective) ||
      !round.turnOrder.includes(you.playerId) ||
      round.droppedIds.includes(you.playerId)
    ) {
      return;
    }

    const roundNo = round.roundNo;
    if (
      aiUploadComplete.current.has(roundNo) ||
      aiUploadInFlight.current.has(roundNo)
    ) {
      return;
    }
    const attempts = aiUploadAttempts.current.get(roundNo) ?? 0;
    if (attempts >= 2) {
      aiUploadComplete.current.add(roundNo);
      return;
    }
    aiUploadAttempts.current.set(roundNo, attempts + 1);
    aiUploadInFlight.current.add(roundNo);

    void (async () => {
      try {
        const png = await drawingReferencePng(round.strokes);
        await uploadOnlineAiSource(code, roundNo, png);
        aiUploadComplete.current.add(roundNo);
      } catch (error) {
        const retryable =
          error instanceof PostRoundAiUploadError && error.retryable;
        if (!retryable || attempts + 1 >= 2) {
          aiUploadComplete.current.add(roundNo);
        } else if (!aiRetryTimers.current.has(roundNo)) {
          const timer = setTimeout(() => {
            aiRetryTimers.current.delete(roundNo);
            setAiRetryTick((value) => value + 1);
          }, 5000);
          aiRetryTimers.current.set(roundNo, timer);
        }
      } finally {
        aiUploadInFlight.current.delete(roundNo);
      }
    })();
  }, [aiRetryTick, code, room.joined, round, state, watch, you?.playerId]);

  useEffect(
    () => () => {
      for (const timer of aiRetryTimers.current.values()) clearTimeout(timer);
      aiRetryTimers.current.clear();
    },
    [],
  );

  // Release the card peek if the pointer never comes back (e.g. system gesture).
  useEffect(() => {
    if (!peekCard) return;
    const off = () => setPeekCard(false);
    window.addEventListener("pointerup", off);
    window.addEventListener("pointercancel", off);
    return () => {
      window.removeEventListener("pointerup", off);
      window.removeEventListener("pointercancel", off);
    };
  }, [peekCard]);

  if (room.gone) {
    return (
      <Screen>
        <div className="header--strip kicker" style={{ borderBottom: "3px solid var(--ink)" }}>
          <span>Room {code}</span>
          <span className="u-red">Closed</span>
        </div>
        <div className="grow" style={{ display: "flex", flexDirection: "column", justifyContent: "center", gap: 16, padding: "0 22px" }}>
          <div className="shout" style={{ fontSize: 44, lineHeight: 0.88 }}>
            This room
            <br />
            has closed
          </div>
          <div className="body-copy u-muted">
            Rooms stay warm for 15 minutes after the last player leaves. Open a fresh one and send
            the new link around.
          </div>
          <Btn variant="ink" onClick={onExit}>
            Back to the entrance
          </Btn>
        </div>
      </Screen>
    );
  }

  let body: ReactNode;
  const me = state?.players.find((p) => p.id === you?.playerId);
  const isHost = !watch && !!you?.isHost;

  if (watch) {
    body = <WatchBody code={code} state={state} live={room.live} />;
  } else if (!state || !room.joined || !me) {
    body = (
      <JoinerSetup
        code={code}
        state={state}
        connected={room.connected}
        error={room.error}
        onJoin={(name, colorIndex) => room.join(name, colorIndex)}
        onLeave={onExit}
      />
    );
  } else if (state.phase === "lobby") {
    body = (
      <HostLobby
        state={state}
        youId={me.id}
        isHost={isHost}
        shareUrl={`${location.origin}/r/${code}`}
        onSettings={(patch) => room.send({ t: "settings", settings: patch })}
        onStart={() => room.send({ t: "start" })}
        onRules={() => setShowRules(true)}
        onKick={(playerId) => room.send({ t: "dropPlayer", playerId })}
        onHouseWords={() => setShowHouse(true)}
      />
    );
  } else if (state.phase === "closed") {
    // CLOSE_GAME clears the round, so this must come before the !round guard.
    body = (
      <Final
        players={state.players}
        archive={state.archive}
        totalRounds={state.settings.rounds}
        onAgain={isHost ? () => room.send({ t: "again" }) : undefined}
        waiting="The host can open another exhibition"
      />
    );
  } else if (!round) {
    body = <Waiting kicker={`Room ${code}`} title="One moment" />;
  } else {
    const r: PublicRoundState = round;
    const qm = r.qmId ? state.players.find((p) => p.id === r.qmId) : null;
    const myCard = () => (
      <RoleCard
        fake={you!.role === "fake"}
        playerName={me.name}
        category={r.category}
        word={you!.word}
        colorIndex={me.colorIndex}
      />
    );

    if (state.phase === "dealing") {
      if (!r.dealt) {
        body =
          you!.role === "qm" ? (
            <QmWord
              qmName={me.name}
              roundNo={r.roundNo}
              totalRounds={state.settings.rounds}
              category={r.category}
              word={you!.word ?? ""}
              artists={r.turnOrder.length}
              onRedraw={() => room.send({ t: "redraw" })}
              onDeal={() => room.send({ t: "deal" })}
            />
          ) : (
            <Waiting
              tone="ink"
              kicker={`Round ${r.roundNo} / ${state.settings.rounds}`}
              title={
                <>
                  {qm?.name ?? "The question master"}
                  <br />
                  is setting
                  <br />
                  the word
                </>
              }
              body="They say the category out loud, not the word. Cards go out in a moment."
            />
          );
      } else if (
        (you!.role === "artist" || you!.role === "fake") &&
        !r.seen.includes(me.id)
      ) {
        body = (
          <HoldToReveal
            label="Hold to read your card"
            gate={
              <Screen>
                <div className="header--strip kicker" style={{ borderBottom: "3px solid var(--ink)" }}>
                  <span>Your card</span>
                  <span>
                    {r.seen.length} of {mustSee(r).length} seen
                  </span>
                </div>
                <div className="grow" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 24, padding: "0 24px" }}>
                  <div className="avatar avatar--ink">{me.name.slice(0, 1).toUpperCase()}</div>
                  <div className="u-center" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    <div className="shout" style={{ fontSize: 44, lineHeight: 0.88 }}>
                      Your card,
                      <br />
                      {me.name}
                    </div>
                    <div className="body-copy">
                      Keep the glass to yourself. Nothing shows until your thumb is on it.
                    </div>
                  </div>
                  <div className="u-center" style={{ width: "100%", border: "3px solid var(--ink)", padding: 22, display: "flex", flexDirection: "column", gap: 6 }}>
                    <div className="shout" style={{ fontSize: 16 }}>Press and hold</div>
                    <div className="note">Let go and it's gone</div>
                  </div>
                </div>
                <div style={{ paddingBottom: "calc(28px + env(safe-area-inset-bottom))" }} />
              </Screen>
            }
            card={myCard}
            onFirstRelease={() => room.send({ t: "seen" })}
          />
        );
      } else {
        body = (
          <Waiting
            kicker={`Round ${r.roundNo} / ${state.settings.rounds}`}
            title={
              <>
                Cards are
                <br />
                going out
              </>
            }
            body={`${r.seen.length} of ${mustSee(r).length} have seen theirs. First stroke lands the moment everyone has.`}
          />
        );
      }
    } else if (state.phase === "drawing") {
      const drawerId = drawerOf(r);
      const drawer = state.players.find((p) => p.id === drawerId);
      const pass = passOf(r, drawerId);
      if (drawerId === me.id) {
        body = (
          <DrawTurn
            key={`${r.roundNo}-${r.turnIndex}`}
            word={you!.role === "fake" ? null : you!.word}
            category={r.category}
            colorIndex={me.colorIndex}
            strokes={r.strokes}
            strokeNo={r.turnIndex + 1}
            strokeTotal={r.schedule.length}
            paused={Object.keys(state.holds).length > 0}
            deadline={r.turnDeadline}
            penMode={state.settings.penMode}
            inkLimit={state.settings.inkLimit}
            onLive={(batch, newSegment) => room.sendLive(batch, newSegment)}
            onLiveClear={() => room.send({ t: "liveClear" })}
            onCommit={(points, breaks) => room.send({ t: "commit", points, breaks })}
          />
        );
      } else {
        const chips = turnChips(r, state.players, me.id);
        const youNext = r.schedule[r.turnIndex + 1] === me.id;
        const canPeek = you!.role === "artist" || you!.role === "fake";
        body = (
          <>
            <Spectate
              kicker={`${code} · pass ${pass} · ${r.turnIndex + 1} of ${r.schedule.length}`}
              drawerName={drawer?.name ?? "…"}
              drawerColor={drawer?.colorIndex ?? 0}
              strokes={r.strokes}
              live={room.live}
              chips={chips}
              strokeNo={r.turnIndex + 1}
              strokeTotal={r.schedule.length}
              liveBadge
              deadline={r.turnDeadline}
              banner={
                canPeek ? (
                  <div
                    style={{ border: "3px solid var(--ink)", padding: "16px 18px", display: "flex", alignItems: "center", gap: 14, userSelect: "none", touchAction: "none" }}
                    onPointerDown={(e) => {
                      e.preventDefault();
                      setPeekCard(true);
                    }}
                  >
                    <span className="swatch" style={{ background: "var(--ink)" }} />
                    <div style={{ flex: 1, fontSize: 14, fontWeight: 600, lineHeight: 1.4 }}>
                      {youNext ? "You're up next. " : ""}Your word is on the card —{" "}
                      <span style={{ textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700 }}>
                        hold to re-read
                      </span>
                      .
                    </div>
                  </div>
                ) : you!.role === "qm" ? (
                  <div className="note" style={{ borderTop: "3px solid var(--ink)", paddingTop: 14, fontSize: 14 }}>
                    You set the word. Watch them dance around it — and keep your face still.
                  </div>
                ) : (
                  <div className="note" style={{ borderTop: "3px solid var(--ink)", paddingTop: 14, fontSize: 14 }}>
                    You're in for the next round. Watch the line arrive as it's drawn.
                  </div>
                )
              }
              headerAction="Rules"
              onHeaderAction={() => setShowRules(true)}
            />
            {peekCard && canPeek && <div className="overlay">{myCard()}</div>}
          </>
        );
      }
    } else if (state.phase === "voting") {
      const voters = activeArtists(r);
      const iVote = voters.includes(me.id);
      const voted = r.votersIn.includes(me.id);
      if (iVote && !voted) {
        body = (
          <Vote
            voterId={me.id}
            candidates={voters}
            qmId={r.qmId}
            players={state.players}
            strokes={r.strokes}
            votersIn={r.votersIn}
            onLock={(targetId) => {
              cueLock();
              room.send({ t: "vote", targetId });
            }}
          />
        );
      } else {
        body = (
          <Waiting
            kicker="Both passes complete"
            title={
              <>
                Ballots
                <br />
                coming in
              </>
            }
            body={`${r.votersIn.length} of ${voters.length} locked in. Votes stay hidden until everyone has.`}
          />
        );
      }
    } else if (state.phase === "guessing") {
      const fake = state.players.find((p) => p.id === r.fakeId);
      if (tallySeen !== r.roundNo && r.votes) {
        body = (
          <Tally
            votes={r.votes}
            players={state.players}
            accusedId={r.accusedId}
            fakeWasAccused={true}
            buttonLabel={me.id === r.fakeId ? "Name the picture" : "Watch them squirm"}
            onContinue={() => setTallySeen(r.roundNo)}
          />
        );
      } else if (me.id === r.fakeId) {
        body = (
          <Guess
            category={r.category}
            strokes={r.strokes}
            deadline={r.guessDeadline}
            onSubmit={(text) => room.send({ t: "guess", text })}
          />
        );
      } else {
        body = <GuessWait fakeName={fake?.name ?? "The fake"} deadline={r.guessDeadline} />;
      }
    } else if (state.phase === "reveal") {
      const voided = r.outcome === "voided";
      // isGameOver, not a rounds comparison — score-to-10 games end on points.
      const isLastRound = isGameOver(state);
      // Derive rather than trust the stored step: a voided round arrives in the
      // same broadcast that flips the phase, one frame ahead of the effect.
      if (reveal.step === "critic") {
        body = (
          <CriticVerdict
            ai={r.ai}
            players={state.players}
            onNext={() => {
              // Remember an unfinished verdict so it can announce itself later.
              reveal.leaveCritic(r.ai.criticStatus === "pending");
            }}
          />
        );
      } else if (
        reveal.step === "attribution" &&
        !voided &&
        r.outcome === "survived" &&
        tallySeen !== r.roundNo &&
        r.votes &&
        Object.keys(r.votes).length > 0
      ) {
        body = (
          <Tally
            votes={r.votes}
            players={state.players}
            accusedId={r.accusedId}
            fakeWasAccused={false}
            buttonLabel="The attribution"
            onContinue={() => setTallySeen(r.roundNo)}
          />
        );
      } else if (reveal.step === "attribution") {
        const revealRound = {
          ...r,
          word: r.word ?? "?",
          fakeId: r.fakeId ?? "?",
          votes: r.votes ?? {},
          guess: r.guess,
        };
        body = (
          <Reveal
            round={revealRound}
            players={state.players}
            totalRounds={state.settings.rounds}
            isLastRound={isLastRound}
            nextLabel={
              voided
                ? isHost
                  ? "Re-deal the round"
                  : undefined
                : reveal.aiExhibition
                  ? "What it became"
                  : "Standings"
            }
            onNext={
              voided
                ? isHost
                  ? () => room.send({ t: "next" })
                  : undefined
                : () => reveal.leaveAttribution()
            }
            waiting="Waiting for the host to re-deal…"
          />
        );
      } else if (reveal.step === "rendition") {
        body = (
          <RenditionReveal
            ai={r.ai}
            strokes={r.strokes}
            title={r.ai.critic?.title}
            onNext={() => {
              reveal.leaveRendition(r.ai.renditionStatus === "pending");
            }}
          />
        );
      } else {
        const { critic: skippedCritic, rendition: skippedRendition } = reveal.skipped;
        body = (
          <Standings
            players={state.players}
            roundsPlayed={state.roundsPlayed}
            totalRounds={state.settings.rounds}
            scoreMode={state.settings.winMode === "score10"}
            nextLabel={isLastRound ? "Close the exhibition" : `Round ${state.roundsPlayed + 1}`}
            onNext={isHost ? () => room.send({ t: "next" }) : undefined}
            waiting="Waiting for the host…"
            banner={
              <>
                {skippedCritic && (
                  <VerdictChip
                    ai={r.ai}
                    target="critic"
                    onOpen={() => reveal.setStep("critic")}
                  />
                )}
                {skippedRendition && (
                  <VerdictChip
                    ai={r.ai}
                    target="rendition"
                    onOpen={() => reveal.setStep("rendition")}
                  />
                )}
              </>
            }
          />
        );
      }
    } else {
      body = <Waiting kicker={`Room ${code}`} title="One moment" />;
    }
  }

  const paused =
    state &&
    Object.keys(state.holds).length > 0 &&
    ["dealing", "drawing", "voting", "guessing"].includes(state.phase);

  // Screen identity — changing it plays the entry transition.
  const screenId = (() => {
    if (watch) {
      return `w:${state?.phase ?? "x"}:${round?.roundNo ?? 0}:${
        state?.phase === "drawing" ? (round ? (drawerOf(round) ?? "") : "") : ""
      }`;
    }
    if (!state || !room.joined || !me) return "join";
    switch (state.phase) {
      case "lobby":
        return "lobby";
      case "closed":
        return "closed";
      case "dealing":
        return `deal:${round?.roundNo}:${
          !round?.dealt
            ? you?.role === "qm"
              ? "qm"
              : "wait"
            : round && !round.seen.includes(me.id) && (you?.role === "artist" || you?.role === "fake")
              ? "card"
              : "seen"
        }`;
      case "drawing":
        return `draw:${round?.roundNo}:${(round ? drawerOf(round) : null) ?? "?"}`;
      case "voting":
        return `vote:${round?.roundNo}:${round?.votersIn.includes(me.id) ? "waiting" : "ballot"}`;
      case "guessing":
        return `guess:${round?.roundNo}:${
          tallySeen !== round?.roundNo ? "tally" : me.id === round?.fakeId ? "input" : "wait"
        }`;
      case "reveal":
        return `reveal:${round?.roundNo}:${reveal.step}:${round?.outcome ?? ""}`;
    }
  })();
  const flood =
    screenId.startsWith("deal:") && (screenId.endsWith(":qm") || screenId.endsWith(":card"))
      ? true
      : screenId.startsWith("guess:") && screenId.endsWith(":input");

  return (
    <>
      <ScreenFade id={screenId} flood={flood}>
        {body}
      </ScreenFade>
      {paused && state && (
        <DisconnectOverlay
          state={state}
          isHost={isHost}
          onDrop={(playerId) => room.send({ t: "dropPlayer", playerId })}
        />
      )}
      {!watch &&
        isHost &&
        state &&
        state.settings.presence === "relaxed" &&
        ["dealing", "drawing", "voting", "guessing"].includes(state.phase) && (
          <AwayNudge state={state} onDrop={(playerId) => room.send({ t: "dropPlayer", playerId })} />
        )}
      {(room.joined || watch) && !room.connected && !room.gone && <ReconnectingBanner />}
      {watch && (
        <div
          className="kicker"
          style={{
            position: "absolute",
            bottom: "calc(10px + env(safe-area-inset-bottom))",
            right: 12,
            zIndex: 35,
            background: "var(--ink)",
            color: "var(--gold)",
            padding: "7px 10px",
            letterSpacing: "0.12em",
          }}
        >
          Watching · {code}
        </div>
      )}
      {showHouse && state && you && (
        <div className="overlay">
          <HouseWords
            ownWords={you.houseWords}
            totalCount={state.houseWordCount}
            note="Your words stay yours — nobody else sees them, and the fake artist is never dealt a word they wrote."
            onAdd={(words) => room.send({ t: "houseWords", add: words })}
            onRemove={(word) => room.send({ t: "houseWords", remove: word })}
            onBack={() => setShowHouse(false)}
          />
        </div>
      )}
      {showRules && (
        <RulesSheet onClose={() => setShowRules(false)} settings={state?.settings} />
      )}
      {room.error && room.joined && (
        <ErrorToast message={room.error} onDone={room.clearError} />
      )}
    </>
  );
}

/** Relaxed rooms never pause — but the host still needs a way past a player
 *  who is away AND currently blocking the round. */
function AwayNudge({
  state,
  onDrop,
}: {
  state: NonNullable<ReturnType<typeof useOnlineRoom>["state"]>;
  onDrop: (playerId: string) => void;
}) {
  const round = state.round;
  if (!round) return null;
  const away = (id: string) => {
    const p = state.players.find((pl) => pl.id === id);
    return p ? !p.connected : false;
  };
  let blockers: string[] = [];
  if (state.phase === "drawing") {
    const drawer = drawerOf(round);
    if (drawer && away(drawer)) blockers = [drawer];
  } else if (state.phase === "dealing" && round.dealt) {
    const need = mustSee(round).filter((id) => !round.seen.includes(id));
    blockers = need.filter(away);
  } else if (state.phase === "dealing" && !round.dealt && round.qmId && away(round.qmId)) {
    blockers = [round.qmId];
  } else if (state.phase === "voting") {
    blockers = activeArtists(round).filter(
      (id) => !round.votersIn.includes(id) && away(id),
    );
  } else if (state.phase === "guessing" && round.fakeId && away(round.fakeId)) {
    blockers = [round.fakeId];
  }
  if (blockers.length === 0) return null;
  const first = state.players.find((p) => p.id === blockers[0]);
  return (
    <div
      style={{
        position: "absolute",
        bottom: "calc(64px + env(safe-area-inset-bottom))",
        left: 20,
        right: 20,
        zIndex: 38,
        background: "var(--ink)",
        color: "var(--cream)",
        padding: "12px 14px",
        display: "flex",
        alignItems: "center",
        gap: 12,
      }}
    >
      <span style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>
        Waiting on {first?.name ?? "someone"} — their app is closed. The room plays on when they
        return…
      </span>
      <button
        className="shout"
        style={{ fontSize: 13, color: "var(--gold)", flex: "none" }}
        onClick={() => onDrop(blockers[0])}
      >
        Carry on without them
      </button>
    </div>
  );
}

/** Watch-only rendering: the wall, never a card. */
function WatchBody({
  code,
  state,
  live,
}: {
  code: string;
  state: ReturnType<typeof useOnlineRoom>["state"];
  live: ReturnType<typeof useOnlineRoom>["live"];
}) {
  const round = state?.round ?? null;
  const reveal = useRevealSequence({
    outcome: round?.outcome,
    roundNo: round?.roundNo,
    settings: state?.settings,
  });
  if (!state) {
    return <Waiting kicker={`Watching ${code}`} title={<>Tuning in</>} />;
  }
  if (state.phase === "lobby") {
    return (
      <Waiting
        kicker={`Watching ${code}`}
        title={
          <>
            {state.players.length} in
            <br />
            the room
          </>
        }
        body="You're on the balcony — you'll see the wall, never a card. The round opens when the host is ready."
      />
    );
  }
  if (state.phase === "closed") {
    return (
      <Final
        players={state.players}
        archive={state.archive}
        totalRounds={state.settings.rounds}
        waiting="You watched the whole thing"
      />
    );
  }
  if (!round) return <Waiting kicker={`Watching ${code}`} title={<>One moment</>} />;

  if (state.phase === "dealing") {
    return (
      <Waiting
        kicker={`Watching ${code} · round ${round.roundNo}`}
        title={
          <>
            Cards are
            <br />
            going out
          </>
        }
        body={`${round.seen.length} of ${mustSee(round).length} have seen theirs.`}
      />
    );
  }
  if (state.phase === "drawing") {
    const drawer = state.players.find((p) => p.id === drawerOf(round));
    return (
      <Spectate
        kicker={`Watching ${code} · ${round.turnIndex + 1} of ${round.schedule.length}`}
        drawerName={drawer?.name ?? "…"}
        drawerColor={drawer?.colorIndex ?? 0}
        strokes={round.strokes}
        live={live}
        chips={turnChips(round, state.players)}
        strokeNo={round.turnIndex + 1}
        strokeTotal={round.schedule.length}
        liveBadge
        deadline={round.turnDeadline}
      />
    );
  }
  if (state.phase === "voting") {
    const voters = activeArtists(round);
    return (
      <Waiting
        kicker={`Watching ${code}`}
        title={
          <>
            Ballots
            <br />
            coming in
          </>
        }
        body={`${round.votersIn.length} of ${voters.length} locked in. The names stay sealed until everyone has.`}
      />
    );
  }
  if (state.phase === "guessing") {
    const fake = state.players.find((p) => p.id === round.fakeId);
    return <GuessWait fakeName={fake?.name ?? "The fake"} deadline={round.guessDeadline} />;
  }
  // reveal
  if (reveal.step === "critic") {
    return (
      <CriticVerdict
        ai={round.ai}
        players={state.players}
        onNext={() => reveal.leaveCritic(false)}
      />
    );
  }
  const revealRound = {
    ...round,
    word: round.word ?? "?",
    fakeId: round.fakeId ?? "?",
    votes: round.votes ?? {},
    guess: round.guess,
  };
  if (reveal.step === "rendition") {
    return (
      <RenditionReveal
        ai={round.ai}
        strokes={round.strokes}
        title={round.ai.critic?.title}
        onNext={() => reveal.leaveRendition(false)}
      />
    );
  }
  if (reveal.step === "standings") {
    return (
      <Standings
        players={state.players}
        roundsPlayed={state.roundsPlayed}
        totalRounds={state.settings.rounds}
            scoreMode={state.settings.winMode === "score10"}
        waiting="The table decides what's next"
      />
    );
  }
  return (
    <Reveal
      round={revealRound}
      players={state.players}
      totalRounds={state.settings.rounds}
      isLastRound={false}
      nextLabel={reveal.aiExhibition ? "What it became" : "Standings"}
      onNext={() =>
        reveal.leaveAttribution()
      }
    />
  );
}

function ErrorToast({ message, onDone }: { message: string; onDone: () => void }) {
  useEffect(() => {
    const id = setTimeout(onDone, 2600);
    return () => clearTimeout(id);
  }, [message, onDone]);
  return (
    <div
      style={{
        position: "absolute",
        bottom: "calc(24px + env(safe-area-inset-bottom))",
        left: 20,
        right: 20,
        zIndex: 50,
        background: "var(--ink)",
        color: "var(--cream)",
        padding: "14px 16px",
        fontSize: 13,
        fontWeight: 600,
      }}
    >
      {message}
    </div>
  );
}

export { Kicker };
