import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BackLink, Btn, ClockChip } from "../src/components/ui";

describe("shared control semantics", () => {
  it("keeps button intent explicit for assistive technology and forms", () => {
    const markup = renderToStaticMarkup(
      <Btn type="submit" ariaLabel="Open the round">
        Open the round
      </Btn>,
    );

    expect(markup).toContain('type="submit"');
    expect(markup).toContain('aria-label="Open the round"');
  });

  it("gives the back link a full touch target", () => {
    const markup = renderToStaticMarkup(
      <BackLink label="Back to roster" onClick={() => undefined} />,
    );

    expect(markup).toContain('class="kicker u-muted tap-target"');
  });

  it("announces the remaining clock time without becoming a live region", () => {
    const markup = renderToStaticMarkup(<ClockChip deadline={Date.now() + 59_000} />);

    expect(markup).toContain('role="timer"');
    expect(markup).toMatch(/aria-label="5[89] seconds left"/);
    expect(markup).not.toContain("aria-live");
  });
});
