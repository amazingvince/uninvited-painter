// Room codes: four letters, uppercase. Generated codes avoid glyphs that are
// easy to misread aloud or on screen (I, L, O, Q); joining accepts any letters.
const SAFE = "ABCDEFGHJKMNPRSTUVWXYZ";

export function generateRoomCode(rng: () => number = Math.random): string {
  let code = "";
  for (let i = 0; i < 4; i++) {
    code += SAFE[Math.floor(rng() * SAFE.length)];
  }
  return code;
}

export function isValidRoomCode(code: string): boolean {
  return /^[A-Z]{4}$/.test(code);
}

export function normalizeRoomCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4);
}
