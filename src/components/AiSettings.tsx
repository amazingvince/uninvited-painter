import { aiEnabled } from "../../shared/engine";
import type { Settings } from "../../shared/types";
import { SETTING_OPTIONS } from "../lib/settingsOptions";

export function AiSettings({
  settings,
  onChange,
}: {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
}) {
  const enabled = aiEnabled(settings);
  const toggle = (
    label: string,
    detail: string,
    on: boolean,
    onClick: () => void,
  ) => (
    <button
      className={on ? "deck-card deck-card--on" : "deck-card"}
      style={{ textAlign: "left", alignItems: "center" }}
      aria-pressed={on}
      onClick={onClick}
    >
      <span style={{ flex: 1 }}>
        <span className="shout" style={{ display: "block", fontSize: 18 }}>
          {label}
        </span>
        <span className="small" style={{ color: on ? "inherit" : "var(--muted)" }}>
          {detail}
        </span>
      </span>
      <span className="shout" style={{ fontSize: 18 }}>
        {on ? "On" : "Off"}
      </span>
    </button>
  );

  return (
    <section
      className="hairline-top"
      style={{ marginTop: 8, paddingTop: 14, display: "grid", gap: 9 }}
    >
      <div className="kicker" style={{ letterSpacing: "0.1em" }}>
        Post-round AI
      </div>
      {toggle(
        "Luna critic",
        "Titles, guesses and reviews the finished piece.",
        settings.aiCritic,
        () => onChange({ aiCritic: !settings.aiCritic }),
      )}
      {toggle(
        "AI detective",
        "Names a suspect after your ballots. Never counts.",
        settings.aiDetective,
        () => onChange({ aiDetective: !settings.aiDetective }),
      )}
      {enabled && (
        <div>
          <div className="kicker" style={{ fontSize: 12, paddingBottom: 6 }}>
            Critic temperament
          </div>
          <div className="seg" style={{ width: "100%" }}>
            {SETTING_OPTIONS.tone.map(({ value: tone, label }) => (
              <button
                key={tone}
                className={settings.aiTone === tone ? "on" : ""}
                style={{ flex: 1, fontSize: 13 }}
                onClick={() => onChange({ aiTone: tone })}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}
      {enabled && (
        <div className="note" style={{ fontSize: 12, lineHeight: 1.45 }}>
          The finished drawing is sent to OpenAI and uses API credits. GPT Image
          2 automatically makes the realistic version while everyone votes.
        </div>
      )}
    </section>
  );
}
