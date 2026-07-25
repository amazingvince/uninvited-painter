// A5 Rules sheet — reachable from any screen via the header.

import { useState } from "react";
import { aiEnabled } from "../../shared/engine";
import type { Settings } from "../../shared/types";
import { setSoundEnabled, soundEnabled } from "../lib/sound";
import { Screen, Kicker } from "./ui";

const PASS_WORD = ["", "One pass", "Two passes", "Three passes"];

/** The sheet describes the room you are actually in, not the default one. */
function steps(settings?: Settings): string[] {
  const passes = settings?.passes ?? 2;
  const pen =
    settings?.penMode === "free"
      ? settings.inkLimit > 0
        ? "In turn, each artist draws as many lines as their ink allows, then ends the turn."
        : "In turn, each artist draws freely in their own colour, then ends the turn."
      : "In turn, each artist draws one unbroken line in their own colour. Lift your finger and the turn is over.";
  return [
    settings?.qmMode === "off"
      ? "Everyone sees the category. Every artist but one also sees the word."
      : "The question master sets the word. Every artist but one gets to see it.",
    pen,
    `${PASS_WORD[passes] ?? `${passes} passes`} around the table. Draw well enough to prove you know the word — badly enough that the fake can't guess it.`,
    settings?.strokeClock
      ? `Everyone votes. Ties acquit. If the fake artist is caught, they get one guess at the word. Turns time out after ${settings.strokeClock}s.`
      : "Everyone votes. Ties acquit. If the fake artist is caught, they get one guess at the word.",
  ];
}

/** The two Luna options are independent. A detective-only room gets no title,
 *  subject guess, rating or review at all — the provider is told to return
 *  null for them — so promising a review there is a lie. */
function lunaDoes(settings?: Settings): string {
  const critic = !!settings?.aiCritic;
  const detective = !!settings?.aiDetective;
  if (critic && detective) {
    return "She reviews it, guesses the subject, and names a suspect — her opinion is entertainment and never changes the score.";
  }
  if (detective) {
    return "She names a suspect and says why — entertainment only, never part of the score.";
  }
  return "She reviews it and guesses the subject — entertainment only, never part of the score.";
}

export function RulesSheet({
  onClose,
  settings,
}: {
  onClose: () => void;
  /** Omitted outside a game (the entrance), where defaults are the honest answer. */
  settings?: Settings;
}) {
  const [sound, setSound] = useState(soundEnabled());
  const STEPS = steps(settings);
  const luna = settings ? aiEnabled(settings) : false;
  return (
    <div className="overlay">
      <Screen>
        <div className="header">
          <button className="kicker u-muted" onClick={onClose}>
            ✕ Close
          </button>
          <div className="shout" style={{ fontSize: 30, letterSpacing: "-0.035em" }}>
            How it works
          </div>
        </div>
        <div className="grow scroll pad" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {STEPS.map((step, i) => (
            <div key={i} style={{ display: "flex", gap: 14 }}>
              <div className="shout u-red" style={{ fontSize: 26, lineHeight: 1 }}>
                {String(i + 1).padStart(2, "0")}
              </div>
              <div
                className="body-copy"
                style={{ fontSize: 14 }}
                dangerouslySetInnerHTML={{
                  __html: step.replace("one unbroken line", "<strong>one unbroken line</strong>"),
                }}
              />
            </div>
          ))}
          <div style={{ borderTop: "3px solid var(--ink)", paddingTop: 16, display: "flex", flexDirection: "column", gap: 8 }}>
            <div className="shout" style={{ fontSize: 18, letterSpacing: "-0.02em" }}>
              Scoring
            </div>
            {[
              ["Fake artist survives the vote", "+2 fake & QM"],
              ["Caught but names the word", "+2 fake & QM"],
              ["Caught and guesses wrong", "+1 each artist"],
            ].map(([left, right], i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: 13,
                  fontWeight: 600,
                  borderBottom: i < 2 ? "1px solid var(--rule)" : "none",
                  paddingBottom: 7,
                  gap: 12,
                }}
              >
                <span>{left}</span>
                <span style={{ fontFamily: "var(--shout)" }}>{right}</span>
              </div>
            ))}
            <Kicker style={{ color: "var(--muted)", paddingTop: 8 }}>
              A tie in the vote counts as survived
            </Kicker>
          </div>
          {luna && (
            <div style={{ borderTop: "3px solid var(--ink)", paddingTop: 16, display: "flex", flexDirection: "column", gap: 8 }}>
              <div className="shout" style={{ fontSize: 18, letterSpacing: "-0.02em" }}>
                Luna
              </div>
              <div className="body-copy" style={{ fontSize: 14 }}>
                An art critic looks at the finished picture without being told the
                word. {lunaDoes(settings)}
              </div>
            </div>
          )}
          <button
            style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid var(--rule)", paddingTop: 12 }}
            onClick={() => {
              setSoundEnabled(!sound);
              setSound(!sound);
            }}
          >
            <span className="kicker" style={{ fontSize: 13, letterSpacing: "0.08em" }}>
              Sound &amp; haptics
            </span>
            <span className="shout" style={{ fontSize: 14, color: sound ? "var(--green)" : "var(--muted)" }}>
              {sound ? "On" : "Off"}
            </span>
          </button>
        </div>
        <div className="footer footer--rule">
          <button className="btn btn--outline" onClick={onClose}>
            Got it
          </button>
        </div>
      </Screen>
    </div>
  );
}
