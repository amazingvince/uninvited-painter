// Link-preview tags. Pure string building, kept out of worker/ so the tests
// (which typecheck against the browser project) can reach it without pulling
// in Worker-only globals like HTMLRewriter.
//
// The shell ships with the generic set baked into index.html so that *any*
// route — the bare domain most of all — previews as something. Routes that
// know more replace them in worker/og.ts.

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

export function metaTags(tags: Record<string, string>): string {
  return Object.entries(tags)
    .map(([property, content]) => `<meta property="${property}" content="${escapeAttr(content)}">`)
    .join("");
}

const TAGLINE = "Everyone gets one stroke. One player was never told the word.";

export function homeTags(origin: string): Record<string, string> {
  return {
    "og:title": "The Uninvited Painter",
    "og:description": `${TAGLINE} A drawing party game for 5–12 players.`,
    "og:image": `${origin}/og-room.png`,
    "og:url": `${origin}/`,
    "og:type": "website",
    "twitter:card": "summary_large_image",
  };
}

export function roomTags(origin: string, code: string): Record<string, string> {
  return {
    "og:title": `Room ${code} — The Uninvited Painter`,
    "og:description": `${TAGLINE} Tap to take a seat.`,
    "og:image": `${origin}/og-room.png`,
    "og:url": `${origin}/r/${code}`,
    "og:type": "website",
    "twitter:card": "summary_large_image",
  };
}

/** Spectator links: the same room, but the invitation is to watch, not to play. */
export function watchTags(origin: string, code: string): Record<string, string> {
  return {
    "og:title": `Room ${code} — watch the wall`,
    "og:description": `${TAGLINE} Follow the picture as it is drawn, no seat required.`,
    "og:image": `${origin}/og-room.png`,
    "og:url": `${origin}/w/${code}`,
    "og:type": "website",
    "twitter:card": "summary_large_image",
  };
}

export function archiveTags(
  origin: string,
  id: string,
  title: string,
  rounds: number,
  hasImage: boolean,
): Record<string, string> {
  return {
    "og:title": `${title} — The Uninvited Painter`,
    "og:description": `${rounds} round${rounds === 1 ? "" : "s"} of collective forgery, preserved for the record.`,
    "og:image": hasImage ? `${origin}/api/archives/${id}/og.png` : `${origin}/og-room.png`,
    "og:url": `${origin}/a/${id}`,
    "og:type": "website",
    "twitter:card": "summary_large_image",
  };
}
