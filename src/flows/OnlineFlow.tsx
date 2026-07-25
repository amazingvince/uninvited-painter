// Online mode. Room code + link, every phone draws on the same canvas.
// Target: link tap → drawing in under 10 seconds.

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { PublicRoundState } from "../../shared/protocol";
import { useOnlineRoom } from "../game/onlineClient";
import { Screen, Btn, Kicker } from "../components/ui";
import { HoldToReveal } from "../components/HoldToReveal";
import { RulesSheet } from "../components/RulesSheet";
import { JoinerSetup } from "../screens/JoinerSetup";
import { HostLobby } from "../screens/HostLobby";
import { QmWord } from "../screens/QmWord";
import { RoleCard } from "../screens/RoleCard";
import { Spectate, turnChips } from "../screens/Spectate";
import { DrawTurn } from "../screens/DrawTurn";
import { Vote } from "../screens/Vote";
import { Tally } from "../screens/Tally";
import { Guess, GuessWait } from "../screens/Guess";
import { Reveal } from "../screens/Reveal";
import { Standings } from "../screens/Standings";
import { Final } from "../screens/Final";
import { DisconnectOverlay, ReconnectingBanner } from "../screens/Disconnect";

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

export function OnlineFlow({ code, onExit }: { code: string; onExit: () => void }) {
  const room = useOnlineRoom(code);
  const [showRules, setShowRules] = useState(false);
  const [peekCard, setPeekCard] = useState(false);
  const [tallySeen, setTallySeen] = useState<number>(0); // roundNo whose tally was dismissed
  const [revealStep, setRevealStep] = useState<"reveal" | "standings">("reveal");

  const { state, you } = room;
  const round = state?.round ?? null;

  useEffect(() => {
    setRevealStep("reveal");
  }, [round?.roundNo, round?.outcome]);

  // A re-dealt (voided) round keeps its round number — the tally gate must
  // re-arm whenever fresh cards go out.
  useEffect(() => {
    if (state?.phase === "dealing" || state?.phase === "lobby") setTallySeen(0);
  }, [state?.phase]);

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
  const isHost = !!you?.isHost;

  if (!state || !room.joined || !me) {
    body = (
      <JoinerSetup
        code={code}
        state={state}
        connected={room.connected}
        error={room.error}
        onJoin={(name, colorIndex) => room.join(name, colorIndex)}
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
            gate={
              <Screen>
                <div className="header--strip kicker" style={{ borderBottom: "3px solid var(--ink)" }}>
                  <span>Your card</span>
                  <span>
                    {r.seen.length} of {r.turnOrder.length + (r.qmId ? 1 : 0)} seen
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
            body={`${r.seen.length} of ${r.turnOrder.length + (r.qmId ? 1 : 0)} have seen theirs. First stroke lands the moment everyone has.`}
          />
        );
      }
    } else if (state.phase === "drawing") {
      const drawerId = r.schedule[r.turnIndex] ?? null;
      const drawer = state.players.find((p) => p.id === drawerId);
      const pass = r.turnIndex < r.turnOrder.length ? 1 : 2;
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
            onLive={(batch) => room.sendLive(batch)}
            onLiveClear={() => room.send({ t: "liveClear" })}
            onCommit={(points) => room.send({ t: "commit", points })}
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
      const voters = r.turnOrder.filter((id) => !r.droppedIds.includes(id));
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
            onLock={(targetId) => room.send({ t: "vote", targetId })}
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
      const isLastRound = state.roundsPlayed >= state.settings.rounds;
      if (!voided && r.outcome === "survived" && tallySeen !== r.roundNo && r.votes && Object.keys(r.votes).length > 0) {
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
      } else if (revealStep === "reveal") {
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
            nextLabel={voided ? (isHost ? "Re-deal the round" : undefined) : "Standings"}
            onNext={
              voided
                ? isHost
                  ? () => room.send({ t: "next" })
                  : undefined
                : () => setRevealStep("standings")
            }
            waiting="Waiting for the host to re-deal…"
          />
        );
      } else {
        body = (
          <Standings
            players={state.players}
            roundsPlayed={state.roundsPlayed}
            totalRounds={state.settings.rounds}
            nextLabel={isLastRound ? "Close the exhibition" : `Round ${state.roundsPlayed + 1}`}
            onNext={isHost ? () => room.send({ t: "next" }) : undefined}
            waiting="Waiting for the host…"
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

  return (
    <>
      {body}
      {paused && state && (
        <DisconnectOverlay
          state={state}
          isHost={isHost}
          onDrop={(playerId) => room.send({ t: "dropPlayer", playerId })}
        />
      )}
      {room.joined && !room.connected && !room.gone && <ReconnectingBanner />}
      {showRules && <RulesSheet onClose={() => setShowRules(false)} />}
      {room.error && room.joined && (
        <ErrorToast message={room.error} onDone={room.clearError} />
      )}
    </>
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
