import type { ReactNode } from "react";

export function HoldPeek({
  label,
  children,
  revealed,
  onRevealChange,
}: {
  label: string;
  children: ReactNode;
  revealed: boolean;
  onRevealChange: (revealed: boolean) => void;
}) {
  const release = () => onRevealChange(false);

  return (
    <button
      type="button"
      className="hold-peek tap-target"
      aria-label={label}
      aria-pressed={revealed}
      onPointerDown={() => onRevealChange(true)}
      onPointerUp={release}
      onPointerCancel={release}
      onPointerLeave={release}
      onLostPointerCapture={release}
      onKeyDown={(event) => {
        if ((event.key === " " || event.key === "Enter") && !event.repeat) {
          event.preventDefault();
          onRevealChange(true);
        }
      }}
      onKeyUp={(event) => {
        if (event.key === " " || event.key === "Enter") release();
      }}
      onBlur={release}
    >
      {children}
    </button>
  );
}
