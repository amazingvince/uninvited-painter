export type ActionResult =
  | "done"
  | "cancelled"
  | "unavailable"
  | "failed";

function defaultClipboard(): Pick<Clipboard, "writeText"> | undefined {
  return typeof navigator === "undefined" ? undefined : navigator.clipboard;
}

function defaultShare(): Navigator["share"] | undefined {
  return typeof navigator === "undefined"
    ? undefined
    : navigator.share?.bind(navigator);
}

export async function copyText(
  text: string,
  clipboard: Pick<Clipboard, "writeText"> | undefined = defaultClipboard(),
): Promise<ActionResult> {
  if (!clipboard) return "unavailable";
  try {
    await clipboard.writeText(text);
    return "done";
  } catch {
    return "failed";
  }
}

export async function shareLink(
  data: ShareData,
  share: Navigator["share"] | undefined = defaultShare(),
): Promise<ActionResult> {
  if (!share) return "unavailable";
  try {
    await share(data);
    return "done";
  } catch (error) {
    return error instanceof DOMException && error.name === "AbortError"
      ? "cancelled"
      : "failed";
  }
}
