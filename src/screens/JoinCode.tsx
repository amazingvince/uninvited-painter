// D3 Join by code — letters only, uppercase, no ambiguous glyphs in generated
// codes. Or open the link they sent — it skips this screen entirely.

import { useState } from "react";
import { Screen, BackLink } from "../components/ui";

const ROWS = ["QWERTYU", "IOPASDF", "GHJKLZX", "CVBNM"];

export function JoinCode({
  onBack,
  onEnter,
  checking,
  error,
}: {
  onBack: () => void;
  onEnter: (code: string) => void;
  checking: boolean;
  error: string | null;
}) {
  const [code, setCode] = useState("");

  const press = (letter: string) => {
    if (code.length < 4) setCode(code + letter);
  };

  return (
    <Screen>
      <div className="header">
        <BackLink label="← Back" onClick={onBack} />
        <div className="shout" style={{ fontSize: 30, letterSpacing: "-0.035em" }}>
          Four letters
        </div>
      </div>
      <div className="code-cells">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className={
              i === code.length
                ? "code-cell code-cell--cursor"
                : i < code.length
                  ? "code-cell"
                  : "code-cell code-cell--empty"
            }
          >
            {code[i] ?? (i === code.length ? <span className="blink">|</span> : "")}
          </div>
        ))}
      </div>
      <div className="small" style={{ padding: "0 20px 10px", fontSize: 13, color: error ? "var(--red)" : "var(--muted)" }}>
        {error ?? "Or open the link they sent — it skips this screen entirely."}
      </div>
      <div className="keyboard">
        {ROWS.flatMap((row) => row.split("")).map((letter) => (
          <button key={letter} onClick={() => press(letter)}>
            {letter}
          </button>
        ))}
        <button className="key-del" onClick={() => setCode(code.slice(0, -1))}>
          DEL
        </button>
      </div>
      <div className="footer">
        <button
          className={code.length === 4 && !checking ? "btn btn--red" : "btn btn--disabled"}
          disabled={code.length !== 4 || checking}
          onClick={() => code.length === 4 && onEnter(code)}
        >
          {checking ? "Checking…" : "Enter room"}
        </button>
      </div>
    </Screen>
  );
}
