import { useMemo } from "react";
import { renderSVG } from "uqr";

/** Ink-on-paper QR block, styled like a plate in the catalogue. */
export function QrCode({ url, size = 148 }: { url: string; size?: number }) {
  const svg = useMemo(
    () =>
      renderSVG(url, {
        ecc: "M",
        border: 2,
        blackColor: "#121212",
        whiteColor: "#fffbf0",
      }),
    [url],
  );
  return (
    <div
      role="img"
      aria-label={`QR code linking to ${url}`}
      style={{ width: size, height: size, flex: "none", border: "2px solid #f2ede1" }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
