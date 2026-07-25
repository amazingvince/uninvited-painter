import { describe, expect, it } from "vitest";
import shell from "../index.html?raw";
import {
  archiveTags,
  homeTags,
  metaTags,
  roomTags,
  watchTags,
} from "../shared/og";

const ORIGIN = "https://painter.amazingvince.com";

/** Every preview needs all of these — a crawler with a missing image or url
 *  renders a bare link, which is the bug this whole module exists to avoid. */
const REQUIRED = [
  "og:title",
  "og:description",
  "og:image",
  "og:url",
  "og:type",
  "twitter:card",
];

describe("og tags", () => {
  const sets: Record<string, Record<string, string>> = {
    home: homeTags(ORIGIN),
    room: roomTags(ORIGIN, "MOLT"),
    watch: watchTags(ORIGIN, "MOLT"),
    archive: archiveTags(ORIGIN, "abcdefgh2345", 5),
    "archive of one round": archiveTags(ORIGIN, "abcdefgh2345", 1),
  };

  for (const [name, tags] of Object.entries(sets)) {
    it(`${name} carries every required tag`, () => {
      for (const key of REQUIRED) {
        expect(tags[key], `${name} is missing ${key}`).toBeTruthy();
      }
    });

    it(`${name} points its urls at ${ORIGIN}`, () => {
      expect(tags["og:image"]).toMatch(/^https:\/\//);
      expect(tags["og:url"]).toMatch(/^https:\/\//);
    });
  }

  it("sends spectator links to the watch route, not a seat", () => {
    expect(watchTags(ORIGIN, "MOLT")["og:url"]).toBe(`${ORIGIN}/w/MOLT`);
    expect(roomTags(ORIGIN, "MOLT")["og:url"]).toBe(`${ORIGIN}/r/MOLT`);
    expect(watchTags(ORIGIN, "MOLT")["og:title"]).not.toBe(
      roomTags(ORIGIN, "MOLT")["og:title"],
    );
  });

  it("pluralises the archive round count", () => {
    expect(archiveTags(ORIGIN, "abcdefgh2345", 1)["og:description"]).toContain(
      "1 round of",
    );
    expect(archiveTags(ORIGIN, "abcdefgh2345", 3)["og:description"]).toContain(
      "3 rounds of",
    );
  });
});

describe("meta tag rendering", () => {
  it("escapes anything that reaches an attribute value", () => {
    const html = metaTags({ "og:title": '"><script>alert(1)</script><meta x="' });
    expect(html).not.toContain("<script");
    expect(html).toContain("&lt;script");
    // An attribute value must be free of the two characters that could end it
    // or start a tag; `>` inside a quoted value is inert.
    const values = [...html.matchAll(/content="([^"]*)"/g)].map((m) => m[1]);
    expect(values).toHaveLength(1);
    expect(values[0]).not.toMatch(/[<"]/);
    expect(values[0]).toContain("&quot;");
  });

  it("keeps publisher-supplied text out of archive previews entirely", () => {
    // Publishing is open to anyone, so a preview must never be something the
    // publisher chose — escaping is not enough when the content itself is the
    // payload. Only the id and a validated round count may vary.
    const tags = archiveTags(ORIGIN, "abcdefgh2345", 4);
    expect(tags["og:title"]).toBe("A finished game — The Uninvited Painter");
    expect(tags["og:image"]).toBe(`${ORIGIN}/og-room.png`);
    // Two archives may differ only in their id (which has to be in the url)
    // and their round count. Nothing else varies with what was published.
    const other = archiveTags(ORIGIN, "zzzzzzzz9876", 4);
    for (const key of REQUIRED) {
      if (key === "og:url") continue;
      expect(tags[key], key).toBe(other[key]);
    }
  });

  it("escapes ampersands so the attribute stays well formed", () => {
    expect(metaTags({ "og:title": "Cats & Dogs" })).toContain("Cats &amp; Dogs");
  });
});

describe("the shell's baked-in preview", () => {
  // The bare domain is the most-shared url of all and never reaches the
  // worker's og routes, so its tags have to live in the shell itself.
  for (const key of REQUIRED) {
    it(`index.html declares ${key}`, () => {
      expect(shell).toContain(`property="${key}"`);
    });
  }

  it("uses absolute urls, which crawlers require", () => {
    const images = shell.match(/property="og:image"\s+content="([^"]+)"/);
    expect(images?.[1]).toMatch(/^https:\/\//);
  });

  it("declares exactly the tags the worker replaces", () => {
    // serveShellWithOg strips og:*/twitter:* before appending. Anything the
    // shell declares outside that prefix set would survive and contradict the
    // room- or archive-specific preview.
    const declared = [...shell.matchAll(/property="([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(declared)).toEqual(new Set(REQUIRED));
  });
});
