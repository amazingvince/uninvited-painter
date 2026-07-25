// B1 Hand-off — screen is inert until press-and-hold. No card content in the
// DOM before touch. Used in local mode for dealing cards and secret ballots.

import type { ReactNode } from "react";
import { Screen, Kicker } from "../components/ui";
import { HoldToReveal } from "../components/HoldToReveal";

export function HandOff({
  kicker,
  right,
  name,
  hint,
  progress,
  card,
  onSeen,
}: {
  kicker: string;
  right?: string;
  name: string;
  hint: string;
  progress?: { done: number; total: number };
  card: () => ReactNode;
  onSeen: () => void;
}) {
  const gate = (
    <Screen>
      <div className="header--strip kicker" style={{ borderBottom: "3px solid var(--ink)" }}>
        <span>{kicker}</span>
        <span>{right}</span>
      </div>
      <div
        className="grow"
        style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 24, padding: "0 24px" }}
      >
        <div className="avatar avatar--ink">{name.slice(0, 1).toUpperCase()}</div>
        <div className="u-center" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div className="shout" style={{ fontSize: 44, lineHeight: 0.88, letterSpacing: "-0.04em" }}>
            Hand to
            <br />
            {name}
          </div>
          <div className="body-copy">{hint}</div>
        </div>
        <div
          className="u-center"
          style={{ width: "100%", border: "3px solid var(--ink)", padding: 22, display: "flex", flexDirection: "column", gap: 6 }}
        >
          <div className="shout" style={{ fontSize: 16, letterSpacing: "-0.01em" }}>
            Press and hold
          </div>
          <div className="note" style={{ lineHeight: 1.2 }}>
            Let go and it's gone
          </div>
        </div>
      </div>
      {progress && (
        <div className="deal-progress">
          {Array.from({ length: progress.total }, (_, i) => (
            <div key={i} className={i < progress.done ? "on" : ""} />
          ))}
        </div>
      )}
      {!progress && <div style={{ paddingBottom: "calc(28px + env(safe-area-inset-bottom))" }} />}
    </Screen>
  );

  return (
    <HoldToReveal
      gate={gate}
      card={card}
      onFirstRelease={onSeen}
      label={`Hold to read ${name}'s card`}
    />
  );
}

export function Interstitial({
  kicker,
  right,
  avatar,
  title,
  body,
  buttonLabel,
  onButton,
  footer,
}: {
  kicker: string;
  right?: ReactNode;
  avatar: string;
  title: ReactNode;
  body: string;
  buttonLabel: string;
  onButton: () => void;
  footer?: ReactNode;
}) {
  return (
    <Screen>
      <div className="header--strip kicker" style={{ borderBottom: "3px solid var(--ink)" }}>
        <span>{kicker}</span>
        <span className="u-red">{right}</span>
      </div>
      <div
        className="grow"
        style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 26, padding: "0 24px" }}
      >
        <div className="avatar avatar--outline">{avatar}</div>
        <div className="u-center" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div className="shout" style={{ fontSize: 44, lineHeight: 0.88, letterSpacing: "-0.04em" }}>
            {title}
          </div>
          <div className="body-copy">{body}</div>
        </div>
        <button className="btn btn--ink" onClick={onButton}>
          {buttonLabel}
        </button>
      </div>
      <div
        className="kicker"
        style={{
          borderTop: "3px solid var(--ink)",
          padding: "16px 20px calc(28px + env(safe-area-inset-bottom))",
          display: "flex",
          justifyContent: "space-between",
          letterSpacing: "0.1em",
          color: "var(--muted)",
        }}
      >
        {footer ?? <span />}
      </div>
    </Screen>
  );
}

export { Kicker };
