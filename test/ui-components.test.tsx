import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CanvasBoard } from "../src/components/CanvasBoard";
import { HoldPeek } from "../src/components/HoldPeek";
import { HoldToReveal } from "../src/components/HoldToReveal";
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

  it("renders a keyboard-capable hold-to-peek control", () => {
    const markup = renderToStaticMarkup(
      <HoldPeek
        label="Hold to peek at the wall"
        revealed={false}
        onRevealChange={() => undefined}
      >
        Hold to peek at the wall
      </HoldPeek>,
    );

    expect(markup).toContain('type="button"');
    expect(markup).toContain('class="hold-peek tap-target"');
    expect(markup).toContain('aria-label="Hold to peek at the wall"');
    expect(markup).toContain('aria-pressed="false"');
  });

  it("names a read-only drawing as an image", () => {
    const markup = renderToStaticMarkup(
      <CanvasBoard strokes={[]} ariaLabel="Finished round 2 drawing." />,
    );

    expect(markup).toContain('role="img"');
    expect(markup).toContain('aria-label="Finished round 2 drawing."');
  });

  it("does not mount private card content before the holder reveals it", () => {
    const markup = renderToStaticMarkup(
      <HoldToReveal
        gate={<span>Pass the phone to Maya</span>}
        card={() => <span>Secret role and word</span>}
      />,
    );

    expect(markup).toContain("Pass the phone to Maya");
    expect(markup).not.toContain("Secret role and word");
  });
});
