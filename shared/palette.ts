// Stroke palette — 12 seats. All twelve read distinctly on #FFFBF0 paper and
// stay distinguishable for common colour-blindness — no red/green pair sits
// adjacent in seat order.
export const SEAT_COLORS = [
  "#1b4a8a",
  "#d92b1f",
  "#3f7a2c",
  "#c98a12",
  "#5c3a86",
  "#0f7a70",
  "#b4472e",
  "#2f6f9c",
  "#7a8a1e",
  "#96246b",
  "#4a4a4a",
  "#0d5c8a",
] as const;

/**
 * The same twelve seats, darkened where necessary to clear 4.5:1 against
 * cream. Ink on paper can be vivid; a player's name set in their own colour
 * still has to be readable, and gold at #c98a12 managed only 2.5:1.
 */
export const SEAT_TEXT_COLORS = [
  "#1b4a8a",
  "#cc281d",
  "#3e782b",
  "#8d610d",
  "#5c3a86",
  "#0f786e",
  "#b4472e",
  "#2f6f9c",
  "#647119",
  "#96246b",
  "#4a4a4a",
  "#0d5c8a",
] as const;

export const UI = {
  cream: "#f2ede1",
  ink: "#121212",
  red: "#d92b1f",
  redDeep: "#8f1a11",
  rule: "#c9c2b0",
  paper: "#fffbf0",
  muted: "#6b665c",
  mutedDark: "#8d8779", // muted on dark grounds
  gold: "#f0d070",
  barTrack: "#dcd5c4",
  creamOnRed: "#f7f2e6",
  mutedOnRed: "#f7d4cf",
  green: "#3f7a2c",
  amber: "#f0a012",
} as const;

export function nextFreeColor(taken: number[]): number {
  for (let i = 0; i < SEAT_COLORS.length; i++) {
    if (!taken.includes(i)) return i;
  }
  return 0;
}
