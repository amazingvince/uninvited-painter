export type NoticeTone = "neutral" | "success" | "error";

export function ActionNotice({
  message,
  tone = "neutral",
  id,
}: {
  message: string | null;
  tone?: NoticeTone;
  id?: string;
}) {
  if (!message) return null;
  return (
    <div
      id={id}
      className={`action-notice action-notice--${tone}`}
      role={tone === "error" ? "alert" : "status"}
      aria-live="polite"
    >
      {message}
    </div>
  );
}
