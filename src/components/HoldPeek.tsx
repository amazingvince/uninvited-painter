import type { ReactNode } from "react";

type RevealChange = (revealed: boolean) => void;

interface HoldPeekRecovery {
  reveal: () => void;
  release: () => void;
  ref: (node: HTMLButtonElement | null) => void;
}

const recoveries = new WeakMap<RevealChange, HoldPeekRecovery>();

function recoveryFor(onRevealChange: RevealChange): HoldPeekRecovery {
  const existing = recoveries.get(onRevealChange);
  if (existing) return existing;

  let cleanup = () => undefined;
  let active = false;
  const release = () => {
    if (!active) return;
    active = false;
    cleanup();
    cleanup = () => undefined;
    onRevealChange(false);
  };
  const reveal = () => {
    cleanup();
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === " " || event.key === "Enter") release();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") release();
    };
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", release);
    document.addEventListener("visibilitychange", onVisibilityChange);
    active = true;
    cleanup = () => {
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", release);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", release);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
    onRevealChange(true);
  };
  const recovery: HoldPeekRecovery = {
    reveal,
    release,
    ref: (node) => {
      if (node === null) release();
    },
  };
  recoveries.set(onRevealChange, recovery);
  return recovery;
}

export function HoldPeek({
  label,
  children,
  revealed,
  onRevealChange,
}: {
  label: string;
  children: ReactNode;
  revealed: boolean;
  onRevealChange: RevealChange;
}) {
  const recovery = recoveryFor(onRevealChange);

  return (
    <button
      ref={recovery.ref}
      type="button"
      className="hold-peek tap-target"
      aria-label={label}
      aria-pressed={revealed}
      onPointerDown={(event) => {
        event.preventDefault();
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
          // Capture is best-effort; the global listeners still release privacy.
        }
        recovery.reveal();
      }}
      onPointerUp={recovery.release}
      onPointerCancel={recovery.release}
      onPointerLeave={recovery.release}
      onLostPointerCapture={recovery.release}
      onKeyDown={(event) => {
        if ((event.key === " " || event.key === "Enter") && !event.repeat) {
          event.preventDefault();
          recovery.reveal();
        }
      }}
      onKeyUp={(event) => {
        if (event.key === " " || event.key === "Enter") recovery.release();
      }}
      onBlur={recovery.release}
    >
      {children}
    </button>
  );
}
