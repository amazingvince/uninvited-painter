// A5 Rules sheet — reachable from any screen via the header.

import { useState } from "react";
import { setSoundEnabled, soundEnabled } from "../lib/sound";
import { Screen, Kicker } from "./ui";

const STEPS = [
  "Everyone sees the category. Every artist but one also sees the word.",
  "In turn, each artist draws one unbroken line in their own colour. Lift your finger and the turn is over.",
  "Two passes around the table. Draw well enough to prove you know the word — badly enough that the fake can't guess it.",
  "Everyone votes. Ties acquit. If the fake artist is caught, they get one guess at the word.",
];

export function RulesSheet({ onClose }: { onClose: () => void }) {
  const [sound, setSound] = useState(soundEnabled());
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
