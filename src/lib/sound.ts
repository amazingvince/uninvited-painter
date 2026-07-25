// Synthesized cues — no audio assets, just short WebAudio envelopes in keeping
// with the gallery's hush. Muted state persists; iOS unlocks on first gesture.

let ctx: AudioContext | null = null;
let unlocked = false;

const MUTE_KEY = "painter.sound";

export function soundEnabled(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) !== "off";
  } catch {
    return true;
  }
}

export function setSoundEnabled(on: boolean): void {
  try {
    localStorage.setItem(MUTE_KEY, on ? "on" : "off");
  } catch {
    /* ignore */
  }
}

function ensureCtx(): AudioContext | null {
  if (typeof AudioContext === "undefined") return null;
  ctx ??= new AudioContext();
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  return ctx;
}

/** Call once from a pointerdown anywhere — browsers gate audio on a gesture. */
export function unlockAudio(): void {
  if (unlocked) return;
  unlocked = true;
  ensureCtx();
}

function tone(
  freq: number,
  duration: number,
  opts: { type?: OscillatorType; gain?: number; delay?: number; slideTo?: number } = {},
): void {
  if (!soundEnabled()) return;
  const audio = ensureCtx();
  if (!audio) return;
  const t0 = audio.currentTime + (opts.delay ?? 0);
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = opts.type ?? "sine";
  osc.frequency.setValueAtTime(freq, t0);
  if (opts.slideTo) osc.frequency.exponentialRampToValueAtTime(opts.slideTo, t0 + duration);
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(opts.gain ?? 0.08, t0 + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0004, t0 + duration);
  osc.connect(gain).connect(audio.destination);
  osc.start(t0);
  osc.stop(t0 + duration + 0.05);
}

function buzz(pattern: number | number[]): void {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* ignore */
  }
}

/** Your turn — a soft double tick plus a nudge in the hand. */
export function cueYourTurn(): void {
  tone(880, 0.09, { gain: 0.06 });
  tone(1320, 0.14, { gain: 0.06, delay: 0.11 });
  buzz([30, 60, 30]);
}

/** A card lands in your hand. */
export function cueCard(): void {
  tone(330, 0.12, { type: "triangle", gain: 0.05 });
  buzz(25);
}

/** Ballot locked in — a shutter click. */
export function cueLock(): void {
  tone(1900, 0.045, { type: "square", gain: 0.03 });
  tone(950, 0.06, { type: "square", gain: 0.025, delay: 0.05 });
}

/** The reveal — a low stamp. */
export function cueReveal(): void {
  tone(220, 0.28, { type: "triangle", gain: 0.09, slideTo: 110 });
  buzz([20, 40, 60]);
}

/** A fresh round opens. */
export function cueRound(): void {
  tone(523, 0.1, { gain: 0.05 });
  tone(659, 0.16, { gain: 0.05, delay: 0.1 });
}

/** Luna clears her throat — the verdict has arrived. */
export function cueVerdict(): void {
  tone(784, 0.12, { type: "triangle", gain: 0.06 });
  tone(988, 0.1, { type: "triangle", gain: 0.05, delay: 0.13 });
  tone(1319, 0.22, { type: "triangle", gain: 0.055, delay: 0.24 });
  buzz([15, 40, 15]);
}

/** The curtain comes off the reality treatment. */
export function cueUnveil(): void {
  tone(440, 0.5, { type: "sine", gain: 0.05, slideTo: 880 });
  tone(1760, 0.18, { type: "triangle", gain: 0.04, delay: 0.42 });
  buzz(35);
}
