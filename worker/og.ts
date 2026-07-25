// Link previews: iMessage/WhatsApp/Discord crawlers read raw HTML without
// running JS, so og: tags are injected into the SPA shell server-side.

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function metaTags(tags: Record<string, string>): string {
  return Object.entries(tags)
    .map(([property, content]) => `<meta property="${property}" content="${escapeAttr(content)}">`)
    .join("");
}

export async function serveShellWithOg(
  request: Request,
  env: Env,
  tags: Record<string, string>,
): Promise<Response> {
  // With SPA fallback the assets binding returns index.html for any app route.
  const shell = await env.ASSETS.fetch(request);
  return new HTMLRewriter()
    .on("head", {
      element(el) {
        el.append(metaTags(tags), { html: true });
      },
    })
    .transform(shell);
}

export function roomTags(origin: string, code: string): Record<string, string> {
  return {
    "og:title": `Room ${code} — The Uninvited Painter`,
    "og:description":
      "Everyone gets one stroke. One player was never told the word. Tap to take a seat.",
    "og:image": `${origin}/og-room.png`,
    "og:url": `${origin}/r/${code}`,
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
