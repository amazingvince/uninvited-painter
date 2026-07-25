// One-shot: rasterize the 1200×630 link-preview card. Run: node scripts/make-og-image.mjs
// (sharp arrives via @vite-pwa/assets-generator's dependencies)
import sharp from "sharp";

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#f2ede1"/>
  <rect x="24" y="24" width="1152" height="582" fill="none" stroke="#121212" stroke-width="6"/>
  <text x="72" y="120" font-family="Arial Black, Arial, sans-serif" font-weight="900" font-size="34" letter-spacing="8" fill="#6b665c">LOT 001 · 5–12 PLAYERS</text>
  <text x="66" y="260" font-family="Arial Black, Arial, sans-serif" font-weight="900" font-size="110" letter-spacing="-2" fill="#121212">THE UNINVITED</text>
  <text x="66" y="380" font-family="Arial Black, Arial, sans-serif" font-weight="900" font-size="110" letter-spacing="-2" fill="#d92b1f">PAINTER</text>
  <rect x="72" y="420" width="1056" height="8" fill="#121212"/>
  <text x="72" y="500" font-family="Arial, sans-serif" font-size="38" fill="#4a463d">Everyone gets one stroke. Two passes.</text>
  <text x="72" y="552" font-family="Arial, sans-serif" font-size="38" fill="#4a463d">One player was never told what the picture is.</text>
  <g transform="translate(960, 440)">
    <rect width="160" height="160" fill="#121212"/>
    <path d="M54 60 A26 26 0 1 1 80 90 L80 101" fill="none" stroke="#d92b1f" stroke-width="17" stroke-linecap="round"/>
    <circle cx="80" cy="127" r="11" fill="#d92b1f"/>
  </g>
</svg>`;

await sharp(Buffer.from(svg), { density: 144 })
  .resize(1200, 630)
  .png()
  .toFile("public/og-room.png");
console.log("wrote public/og-room.png");
