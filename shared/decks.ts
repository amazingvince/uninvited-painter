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
  const { words } = deckById(deckId === "house" ? "everything" : deckId);
  const used = new Set(usedWords);
  let pool = words.filter((w) => !used.has(w.word));
  if (pool.length === 0) pool = words; // deck exhausted mid-session — allow repeats over nothing
  return pool[Math.floor(rng() * pool.length)];
}

/**
 * A word for the round, honouring the house deck: words written by the
 * players themselves, never handing the fake artist a word they authored.
 * Falls back to the built-in decks if the eligible house pool runs dry.
 */
function drawWordFor(
  state: RoomState,
  fakeId: string,
  usedWords: string[],
  rng: () => number,
): { word: string; category: string } {
  if (state.settings.deckId === "house") {
    const used = new Set(usedWords.map((w) => w.toLowerCase()));
    // Exclude by word text, not by row. Submissions are deduped per author
    // (deduping across the pot would leak whether a word is already in it), so
    // a word several people wrote appears several times — filtering on
    // authorId alone leaves the fake's own word in the pool under someone
    // else's name, and a fake who knows the word cannot lose.
    const theirs = new Set(
      state.customWords
        .filter((w) => w.authorId === fakeId)
        .map((w) => w.word.toLowerCase()),
    );
    // One entry per distinct word, so a popular word isn't weighted by how
    // many people happened to write it.
    const pool: string[] = [];
    const seen = new Set<string>();
    for (const { word } of state.customWords) {
      const key = word.toLowerCase();
      if (theirs.has(key) || used.has(key) || seen.has(key)) continue;
      seen.add(key);
      pool.push(word);
    }
    if (pool.length > 0) {
      return { word: pool[Math.floor(rng() * pool.length)], category: "House deck" };
    }
    // Pool dry for this fake — borrow from the full collection instead.
  }
  return drawWord(state.settings.deckId, usedWords, rng);
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
  // Roles first — the house deck must know who the fake is before it can
  // exclude words they authored.
  const qmId = pickQm(state);
  // Absent players sit this round out and get dealt in when they return.
  // Drawing order is shuffled fresh every round — going first or last is a
  // real advantage, so nobody keeps it.
  const turnOrder = shuffle(
    state.players.filter((p) => p.connected && p.id !== qmId).map((p) => p.id),
    rng,
  );
  const fakeId = pickFake(state, turnOrder, rng);
  const { word, category } = drawWordFor(state, fakeId, state.usedWords, rng);
  return { type: "START_ROUND", word, category, qmId, fakeId, turnOrder };
}

/** A replacement word for the QM's "draw another word" (excludes the current one). */
export function redrawWordEvent(
  state: RoomState,
  rng: () => number = Math.random,
): GameEvent {
  const current = state.round?.word;
  const used = current ? [...state.usedWords, current] : state.usedWords;
  const { word, category } = state.round
    ? drawWordFor(state, state.round.fakeId, used, rng)
    : drawWord(state.settings.deckId, used, rng);
  return { type: "REDRAW_WORD", word, category };
}
