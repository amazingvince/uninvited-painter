import { useCallback, useEffect, useState } from "react";
import { createRoom } from "../shared/engine";
import { normalizeRoomCode, isValidRoomCode } from "../shared/codes";
import type { RoomState } from "../shared/types";
import { loadLocalGame, loadLastRoom, clearLocalGame } from "./lib/storage";
import { RulesSheet } from "./components/RulesSheet";
import { Entrance } from "./screens/Entrance";
import { OnlineEntry } from "./screens/OnlineEntry";
import { JoinCode } from "./screens/JoinCode";
import { LocalFlow } from "./flows/LocalFlow";
import { OnlineFlow } from "./flows/OnlineFlow";

type HomeStep = "entrance" | "local" | "online" | "joincode";

function roomCodeFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/r\/([A-Za-z]{4})$/);
  return match ? normalizeRoomCode(match[1]) : null;
}

/** Fresh lobby carrying over the last game's roster, settings and rotation. */
function freshLocal(saved: RoomState | null): RoomState {
  const state = createRoom({ code: "", mode: "local", hostId: "" });
  if (saved) {
    state.players = saved.players.map((p) => ({ ...p, score: 0, connected: true }));
    state.settings = saved.settings;
    state.fakeCounts = saved.fakeCounts;
    state.qmIndex = saved.qmIndex;
    if (state.players.length > 0) state.hostId = state.players[0].id;
  }
  return state;
}

export function App() {
  const [path, setPath] = useState(location.pathname);
  const [step, setStep] = useState<HomeStep>("entrance");
  const [localInitial, setLocalInitial] = useState<RoomState | null>(null);
  const [showRules, setShowRules] = useState(false);
  const [creating, setCreating] = useState(false);
  const [onlineError, setOnlineError] = useState<string | null>(null);
  const [joinChecking, setJoinChecking] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  useEffect(() => {
    const onPop = () => setPath(location.pathname);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const navigate = useCallback((to: string) => {
    history.pushState(null, "", to);
    setPath(to);
  }, []);

  const roomCode = roomCodeFromPath(path);
  if (roomCode) {
    return (
      <div className="frame">
        <OnlineFlow
          code={roomCode}
          onExit={() => {
            navigate("/");
            setStep("entrance");
          }}
        />
      </div>
    );
  }

  const saved = loadLocalGame();
  const canResume = !!saved && saved.phase !== "lobby" && saved.phase !== "closed";

  const openRoom = async () => {
    setCreating(true);
    setOnlineError(null);
    try {
      const res = await fetch("/api/rooms", { method: "POST" });
      const data = (await res.json()) as { code?: string; error?: string };
      if (!res.ok || !data.code) throw new Error(data.error ?? "Could not open a room");
      navigate(`/r/${data.code}`);
    } catch (err) {
      setOnlineError(err instanceof Error ? err.message : "Could not open a room");
    } finally {
      setCreating(false);
    }
  };

  const enterCode = async (raw: string) => {
    const code = normalizeRoomCode(raw);
    if (!isValidRoomCode(code)) return;
    setJoinChecking(true);
    setJoinError(null);
    try {
      const res = await fetch(`/api/rooms/${code}`);
      if (res.status === 404) {
        setJoinError("No room with those letters. Check with whoever invited you.");
        return;
      }
      navigate(`/r/${code}`);
    } catch {
      setJoinError("Couldn't reach the gallery. Check your connection.");
    } finally {
      setJoinChecking(false);
    }
  };

  let body;
  if (step === "local" && localInitial) {
    body = (
      <LocalFlow
        initial={localInitial}
        onExit={() => {
          setStep("entrance");
          setLocalInitial(null);
        }}
      />
    );
  } else if (step === "online") {
    body = (
      <OnlineEntry
        lastRoom={loadLastRoom()}
        busy={creating}
        error={onlineError}
        onBack={() => setStep("entrance")}
        onOpenRoom={openRoom}
        onJoinRoom={() => setStep("joincode")}
        onRejoin={(code) => navigate(`/r/${code}`)}
      />
    );
  } else if (step === "joincode") {
    body = (
      <JoinCode
        onBack={() => setStep("online")}
        onEnter={enterCode}
        checking={joinChecking}
        error={joinError}
      />
    );
  } else {
    body = (
      <Entrance
        canResume={canResume}
        onResume={() => {
          if (saved) {
            setLocalInitial(saved);
            setStep("local");
          }
        }}
        onLocal={() => {
          if (saved && saved.phase !== "lobby") clearLocalGame();
          setLocalInitial(saved && saved.phase === "lobby" ? saved : freshLocal(saved));
          setStep("local");
        }}
        onOnline={() => setStep("online")}
        onRules={() => setShowRules(true)}
      />
    );
  }

  return (
    <div className="frame">
      {body}
      {showRules && <RulesSheet onClose={() => setShowRules(false)} />}
    </div>
  );
}
