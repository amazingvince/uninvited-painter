// A1 Entrance — mode fork. Remembers last roster in localStorage.

import { Screen, Kicker, Btn } from "../components/ui";

export function Entrance({
  onLocal,
  onOnline,
  onRules,
  canResume,
  onResume,
}: {
  onLocal: () => void;
  onOnline: () => void;
  onRules: () => void;
  canResume: boolean;
  onResume: () => void;
}) {
  return (
    <Screen>
      <div className="header--strip kicker" style={{ borderBottom: "3px solid var(--ink)" }}>
        <span>Lot 001</span>
        <span className="u-red">5–12 players</span>
      </div>
      <div
        className="grow"
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "30px 20px 12px",
          minHeight: 0,
          overflowY: "auto",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="shout" style={{ fontSize: "clamp(48px, 17vw, 66px)", lineHeight: 0.85, letterSpacing: "-0.045em" }}>
            The
            <br />
            Uninvited
            <br />
            <span className="u-red">Painter</span>
          </div>
          <div style={{ height: 3, background: "var(--ink)" }} />
          <div className="body-copy" style={{ maxWidth: 300 }}>
            Everyone gets one stroke. Two passes. One player was never told what the picture is.
          </div>
        </div>
        <div className="btn-stack" style={{ paddingTop: 24 }}>
          {canResume && (
            <button
              className="btn"
              style={{ border: "3px dashed var(--muted)", color: "var(--muted)", padding: 17, justifyContent: "space-between" }}
              onClick={onResume}
            >
              <span>Resume last game</span>
              <span>→</span>
            </button>
          )}
          <Btn variant="red" split onClick={onLocal}>
            <span>Pass one phone</span>
            <span>→</span>
          </Btn>
          <Btn variant="outline" split onClick={onOnline}>
            <span>Play online</span>
            <span>→</span>
          </Btn>
          <div
            style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", paddingTop: 6, paddingBottom: 12 }}
          >
            <Kicker style={{ color: "var(--muted)", letterSpacing: "0.1em" }}>First time</Kicker>
            <button
              className="kicker"
              style={{ borderBottom: "2px solid var(--red)", letterSpacing: "0.1em", paddingBottom: 1 }}
              onClick={onRules}
            >
              How it works
            </button>
          </div>
        </div>
      </div>
    </Screen>
  );
}
