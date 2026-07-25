import type { CSSProperties, ReactNode } from "react";
import { SEAT_COLORS } from "../../shared/palette";

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
  variant?: "red" | "ink" | "outline" | "cream" | "disabled";
  onClick?: () => void;
  children: ReactNode;
  disabled?: boolean;
  split?: boolean;
  style?: CSSProperties;
}) {
  const cls = `btn btn--${disabled ? "disabled" : variant}${split ? " btn--split" : ""}`;
  return (
    <button className={cls} onClick={onClick} disabled={disabled} style={style}>
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
