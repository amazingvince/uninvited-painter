// Serves the SPA shell with route-specific link-preview tags swapped in.
// iMessage/WhatsApp/Discord crawlers read raw HTML without running JS, so the
// tags have to be in the response, not applied by the app.
//
// The tag builders themselves live in shared/og.ts; only the rewriting needs
// the Workers runtime.

import { metaTags } from "../shared/og";

export async function serveShellWithOg(
  request: Request,
  env: Env,
  tags: Record<string, string>,
): Promise<Response> {
  // With SPA fallback the assets binding returns index.html for any app route.
  const shell = await env.ASSETS.fetch(request);
  // index.html carries a generic preview so untouched routes still look like
  // something. A crawler keeps the first tag it meets, so the generic copies
  // must go before the specific ones are appended.
  const drop = { element: (el: { remove: () => void }) => el.remove() };
  return new HTMLRewriter()
    .on('meta[property^="og:"]', drop)
    .on('meta[property^="twitter:"]', drop)
    .on("head", {
      element(el) {
        el.append(metaTags(tags), { html: true });
      },
    })
    .transform(shell);
}
