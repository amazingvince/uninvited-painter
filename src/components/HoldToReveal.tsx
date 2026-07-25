// Press-and-hold gate for private cards. Nothing renders until the thumb is on
// the glass; release hides it again. No card content in the DOM before touch.
//
// Holding is the whole ceremony — it is what stops the person beside you
// reading over your shoulder — so it must not be the *only* way in. Keyboard
// and switch users get the same gate via hold-to-activate keys (space/enter),
// and the card hides the instant the key is released or focus leaves.

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

export function HoldToReveal({
  gate,
  card,
  onFirstRelease,
  label = "Hold to read your card",
}: {
  /** The inert screen shown until press-and-hold. */
  gate: ReactNode;
  /** The private card, only mounted while held. */
  card: () => ReactNode;
  /** Fires when the holder lets go having seen the card. */
  onFirstRelease?: () => void;
  /** Accessible name for the hold control. */
  label?: string;
}) {
  const [held, setHeld] = useState(false);
  const releasedOnce = useRef(false);

  const release = () => {
    setHeld(false);
    if (!releasedOnce.current) {
      releasedOnce.current = true;
      onFirstRelease?.();
    }
  };

  // The finger can leave the element (or the capture can fail) — window-level
  // releases make sure the card never sticks open.
  useEffect(() => {
    if (!held) return;
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === " " || e.key === "Enter") release();
    };
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", release);
    return () => {
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", release);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", release);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [held]);

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={label}
      aria-pressed={held}
      className="hold-gate"
      onPointerDown={(e) => {
        e.preventDefault();
        setHeld(true);
        try {
          (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
        } catch {
          // Capture is best-effort — the window-level release listeners cover us.
        }
      }}
      onPointerUp={release}
      onPointerCancel={release}
      onKeyDown={(e) => {
        if ((e.key === " " || e.key === "Enter") && !e.repeat) {
          e.preventDefault();
          setHeld(true);
        }
      }}
      onBlur={() => held && release()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {held ? card() : gate}
    </div>
  );
}
