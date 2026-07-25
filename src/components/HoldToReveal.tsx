// Press-and-hold gate for private cards. Nothing renders until the thumb is on
// the glass; release hides it again. No card content in the DOM before touch.

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

export function HoldToReveal({
  gate,
  card,
  onFirstRelease,
}: {
  /** The inert screen shown until press-and-hold. */
  gate: ReactNode;
  /** The private card, only mounted while held. */
  card: () => ReactNode;
  /** Fires when the holder lets go having seen the card. */
  onFirstRelease?: () => void;
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

  // The finger can leave the element (or the capture can fail) — a window-level
  // release makes sure the card never sticks open.
  useEffect(() => {
    if (!held) return;
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
    return () => {
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", release);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [held]);

  return (
    <div
      style={{ display: "contents" }}
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
      onContextMenu={(e) => e.preventDefault()}
    >
      {held ? card() : gate}
    </div>
  );
}
