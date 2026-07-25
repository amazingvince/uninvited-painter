import { normalizeRoom } from "../../shared/engine";
import type { RoomState } from "../../shared/types";

const LOCAL_GAME = "painter.local.v1";
const LAST_ROOM = "painter.lastRoom.v1";

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private mode / quota — the game just won't persist.
  }
}

export function loadLocalGame(): RoomState | null {
  const saved = read<RoomState>(LOCAL_GAME);
  // A corrupt or ancient save must not wedge the entrance screen.
  if (
    !saved ||
    typeof saved !== "object" ||
    typeof saved.phase !== "string" ||
    !Array.isArray(saved.players) ||
    !saved.settings ||
    typeof saved.settings !== "object"
  ) {
    return null;
  }
  return normalizeRoom(saved);
}

export function saveLocalGame(state: RoomState): void {
  write(LOCAL_GAME, state);
}

export function clearLocalGame(): void {
  try {
    localStorage.removeItem(LOCAL_GAME);
  } catch {
    /* ignore */
  }
}

export interface LastRoom {
  code: string;
  at: number;
}

export function loadLastRoom(): LastRoom | null {
  return read<LastRoom>(LAST_ROOM);
}

export function saveLastRoom(code: string): void {
  write(LAST_ROOM, { code, at: Date.now() });
}

/** Optional seat suffix (?seat=b) so one browser can hold several seats. */
function seatSuffix(): string {
  const seat = new URLSearchParams(location.search).get("seat");
  return seat ? `:${seat}` : "";
}

/** Stable per-room identity so a dropped player can rejoin their seat. */
export function roomToken(code: string): string {
  const key = `painter.token.${code}${seatSuffix()}`;
  let token = null;
  try {
    token = localStorage.getItem(key);
  } catch {
    /* ignore */
  }
  if (!token) {
    token = crypto.randomUUID();
    try {
      localStorage.setItem(key, token);
    } catch {
      /* ignore */
    }
  }
  return token;
}

export function hasJoined(code: string): boolean {
  try {
    return localStorage.getItem(`painter.joined.${code}${seatSuffix()}`) === "1";
  } catch {
    return false;
  }
}

export function markJoined(code: string): void {
  try {
    localStorage.setItem(`painter.joined.${code}${seatSuffix()}`, "1");
  } catch {
    /* ignore */
  }
}
