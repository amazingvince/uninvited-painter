// Between-screen motion: a quiet fade-and-rise for most changes, the design's
// "ink flood" (a dark curtain wiping off) when a private dark screen arrives.
// HoldToReveal stays instant — this keys on screen identity, not press state.

import type { ReactNode } from "react";

export function ScreenFade({
  id,
  flood = false,
  children,
}: {
  /** Changing this string plays the entry animation. */
  id: string;
  /** Ink-flood entry for dark/private screens. */
  flood?: boolean;
  children: ReactNode;
}) {
  return (
    <div key={id} className={flood ? "fade-wrap fade-wrap--flood" : "fade-wrap"}>
      {children}
    </div>
  );
}
