import { useEffect, useRef } from "react";
import { Btn } from "./ui";

export interface ConfirmSheetProps {
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: "danger" | "neutral";
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmSheet({
  title,
  body,
  confirmLabel,
  cancelLabel = "Keep playing",
  tone = "danger",
  onConfirm,
  onCancel,
}: ConfirmSheetProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    cancelRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onCancel();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [
        ...(dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? []),
      ];
      if (focusable.length === 0) {
        event.preventDefault();
        dialogRef.current?.focus();
        return;
      }
      const activeIndex = focusable.indexOf(document.activeElement as HTMLElement);
      if (event.shiftKey && activeIndex <= 0) {
        event.preventDefault();
        focusable[focusable.length - 1]?.focus();
      } else if (!event.shiftKey && activeIndex === focusable.length - 1) {
        event.preventDefault();
        focusable[0]?.focus();
      } else if (activeIndex === -1) {
        event.preventDefault();
        focusable[event.shiftKey ? focusable.length - 1 : 0]?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      opener?.focus();
    };
  }, [onCancel]);

  return (
    <div className="overlay confirm-overlay">
      <section
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        style={{ margin: "auto 20px", border: "3px solid var(--ink)", padding: 20 }}
      >
        <h2 id="confirm-title" className="shout" style={{ fontSize: 30 }}>
          {title}
        </h2>
        <p className="body-copy" style={{ marginTop: 14, marginBottom: 20 }}>
          {body}
        </p>
        <div className="btn-stack">
          <Btn variant={tone === "danger" ? "red" : "ink"} onClick={onConfirm}>
            {confirmLabel}
          </Btn>
          <button ref={cancelRef} className="btn btn--outline" onClick={onCancel}>
            {cancelLabel}
          </button>
        </div>
      </section>
    </div>
  );
}
