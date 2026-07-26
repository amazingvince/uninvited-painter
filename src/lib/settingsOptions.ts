import type {
  AiTone,
  DeckId,
  PenMode,
  Presence,
  QmMode,
  Settings,
  WinMode,
} from "../../shared/types";

export interface SettingOption<T extends string | number> {
  value: T;
  label: string;
}

export const SETTING_OPTIONS = {
  deck: [
    { value: "animals", label: "Animals" },
    { value: "food", label: "Food" },
    { value: "movies", label: "Movies" },
    { value: "objects", label: "Objects" },
    { value: "everything", label: "Everything" },
    { value: "house", label: "House deck" },
  ] satisfies readonly SettingOption<DeckId>[],
  rounds: [
    { value: 3, label: "3 rounds" },
    { value: 5, label: "5 rounds" },
    { value: 7, label: "7 rounds" },
  ],
  winMode: [
    { value: "rounds", label: "Rounds" },
    { value: "score10", label: "First to 10" },
  ] satisfies readonly SettingOption<WinMode>[],
  passes: [
    { value: 1, label: "1 pass" },
    { value: 2, label: "2 passes" },
    { value: 3, label: "3 passes" },
  ],
  pen: [
    { value: "line", label: "One line" },
    { value: "free", label: "Free ink" },
  ] satisfies readonly SettingOption<PenMode>[],
  ink: [
    { value: 0, label: "Unlimited" },
    { value: 120, label: "Long" },
    { value: 60, label: "Short" },
  ],
  clock: [
    { value: 0, label: "Off" },
    { value: 60, label: "60 seconds" },
    { value: 90, label: "90 seconds" },
  ],
  presence: [
    { value: "strict", label: "Pause 30s" },
    { value: "relaxed", label: "Wait for them" },
  ] satisfies readonly SettingOption<Presence>[],
  qm: [
    { value: "rotate", label: "Rotate" },
    { value: "off", label: "Auto word" },
  ] satisfies readonly SettingOption<QmMode>[],
  tone: [
    { value: "witty", label: "Witty" },
    { value: "savage", label: "Savage" },
    { value: "absurd", label: "Absurd" },
  ] satisfies readonly SettingOption<AiTone>[],
} as const;

const ADVANCED_DEFAULTS = {
  penMode: "line",
  inkLimit: 0,
  strokeClock: 0,
  presence: "strict",
  qmMode: "rotate",
  aiCritic: true,
  aiDetective: false,
  aiTone: "witty",
} as const satisfies Pick<
  Settings,
  | "penMode"
  | "inkLimit"
  | "strokeClock"
  | "presence"
  | "qmMode"
  | "aiCritic"
  | "aiDetective"
  | "aiTone"
>;

export function advancedSettingsSummary(
  settings: Settings,
  mode: "local" | "online",
): string {
  const choices: string[] = [];

  if (settings.penMode !== ADVANCED_DEFAULTS.penMode) choices.push("Free ink");
  if (settings.inkLimit !== ADVANCED_DEFAULTS.inkLimit) {
    choices.push(settings.inkLimit === 60 ? "short ink" : "long ink");
  }
  if (mode === "online" && settings.strokeClock !== ADVANCED_DEFAULTS.strokeClock) {
    choices.push(`${settings.strokeClock}s clock`);
  }
  if (mode === "online" && settings.presence !== ADVANCED_DEFAULTS.presence) {
    choices.push("wait for players");
  }
  if (settings.qmMode !== ADVANCED_DEFAULTS.qmMode) choices.push("auto word");
  if (settings.aiCritic !== ADVANCED_DEFAULTS.aiCritic) choices.push("critic off");
  if (settings.aiDetective !== ADVANCED_DEFAULTS.aiDetective) choices.push("detective on");
  if (settings.aiTone !== ADVANCED_DEFAULTS.aiTone) {
    choices.push(`${settings.aiTone} tone`);
  }

  return choices.length > 0 ? choices.join(" · ") : "Standard rules";
}
