import type { CSSProperties, ReactNode } from "react";
import { SEAT_COLORS } from "../../shared/palette";
import { formatClock, useNow } from "../lib/useNow";

/** Small countdown chip for the stroke clock. Amber under ten seconds. */
export function ClockChip({ deadline }: { deadline: number | null | undefined }) {
  const now = useNow(250, deadline != null);
  if (deadline == null) return null;
  const left = Math.max(0, deadline - now);
  return (
    <span
      className="kicker"
      style={{ color: left < 10_000 ? "var(--amber)" : "var(--muted)", letterSpacing: "0.1em" }}
    >
      {formatClock(left)}
    </span>
  );
}

export function Screen({
  tone,
  children,
  style,
}: {
  tone?: "cream" | "ink" | "red";
  children: ReactNode;
  style?: CSSProperties;
}) {
  const cls =
    tone === "ink" ? "screen screen--ink" : tone === "red" ? "screen screen--red" : "screen";
  return (
    <div className={cls} style={style}>
      {children}
    </div>
  );
}

export function Kicker({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div className="kicker" style={style}>
      {children}
    </div>
  );
}

export function Btn({
  variant = "ink",
  onClick,
  children,
  disabled,
  split,
  style,
}: {
  variant?: "red" | "ink" | "outline" | "disabled";
  onClick?: () => void;
  children: ReactNode;
  disabled?: boolean;
  split?: boolean;
  style?: CSSProperties;
}) {
  // Every call site says variant="disabled" rather than disabled — which used
  // to leave the button focusable, so Tab+Enter still fired onClick. Both
  // routes now set the real attribute.
  const off = disabled || variant === "disabled";
  const cls = `btn btn--${off ? "disabled" : variant}${split ? " btn--split" : ""}`;
  return (
    <button className={cls} onClick={onClick} disabled={off} style={style}>
      {children}
    </button>
  );
}

export function Swatch({ index, size = 14 }: { index: number; size?: number }) {
  return (
    <span
      className="swatch"
      style={{ width: size, height: size, background: SEAT_COLORS[index] ?? "#121212" }}
    />
  );
}

export function BackLink({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button className="kicker u-muted" onClick={onClick} style={{ padding: "2px 0" }}>
      {label}
    </button>
  );
}
