// Word decks. Words must be nouns drawable in ~14 short lines; no proper nouns
// outside Movies. Never repeat a word inside one session.

import animals from "./decks/animals.json";
import food from "./decks/food.json";
import movies from "./decks/movies.json";
import objects from "./decks/objects.json";
import type { DeckId, GameEvent, RoomState } from "./types";
import { pickFake, pickQm } from "./engine";

export interface DeckInfo {
  id: DeckId;
  name: string;
  blurb: string;
  words: string[];
}

const REAL_DECKS: DeckInfo[] = [
  { id: "animals", name: "Animals", blurb: "easiest to draw", words: animals as string[] },
  { id: "food", name: "Food", blurb: "", words: food as string[] },
  { id: "movies", name: "Movies", blurb: "hardest", words: movies as string[] },
  { id: "objects", name: "Objects", blurb: "", words: objects as string[] },
];

export function deckList(): DeckInfo[] {
  return REAL_DECKS;
}

function deckById(id: DeckId): { name: string; words: { word: string; category: string }[] } {
  if (id === "everything") {
    return {
      name: "Everything",
      words: REAL_DECKS.flatMap((d) => d.words.map((word) => ({ word, category: d.name }))),
    };
  }
  const deck = REAL_DECKS.find((d) => d.id === id)!;
  return { name: deck.name, words: deck.words.map((word) => ({ word, category: deck.name })) };
}

export function drawWord(
  deckId: DeckId,
  usedWords: string[],
  rng: () => number = Math.random,
): { word: string; category: string } {
  const { words } = deckById(deckId);
  const used = new Set(usedWords);
  let pool = words.filter((w) => !used.has(w.word));
  if (pool.length === 0) pool = words; // deck exhausted mid-session — allow repeats over nothing
  return pool[Math.floor(rng() * pool.length)];
}

function shuffle<T>(items: T[], rng: () => number): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Decide everything random about the next round (word, QM, fake, turn order)
 * and package it as the deterministic START_ROUND event for the reducer.
 */
export function prepareRoundEvent(
  state: RoomState,
  rng: () => number = Math.random,
): GameEvent {
  const { word, category } = drawWord(state.settings.deckId, state.usedWords, rng);
  const qmId = pickQm(state);
  // Absent players sit this round out and get dealt in when they return.
  // Drawing order is shuffled fresh every round — going first or last is a
  // real advantage, so nobody keeps it.
  const turnOrder = shuffle(
    state.players.filter((p) => p.connected && p.id !== qmId).map((p) => p.id),
    rng,
  );
  const fakeId = pickFake(state, turnOrder, rng);
  return { type: "START_ROUND", word, category, qmId, fakeId, turnOrder };
}

/** A replacement word for the QM's "draw another word" (excludes the current one). */
export function redrawWordEvent(
  state: RoomState,
  rng: () => number = Math.random,
): GameEvent {
  const current = state.round?.word;
  const used = current ? [...state.usedWords, current] : state.usedWords;
  const { word, category } = drawWord(state.settings.deckId, used, rng);
  return { type: "REDRAW_WORD", word, category };
}
