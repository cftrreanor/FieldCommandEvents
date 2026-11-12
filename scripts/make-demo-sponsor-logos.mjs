#!/usr/bin/env node
// Makes the made-up sponsor logos demo mode puts on an event (src/lib/demo-sponsors.ts) and writes them, as
// base64 PNGs, to src/lib/demo-sponsor-logos.ts. Text is drawn here (fonts on this machine), so the server never
// needs fonts. Run again only to change the logos: node scripts/make-demo-sponsor-logos.mjs
import { writeFileSync } from "node:fs";
import sharp from "sharp";

const W = 1200;
const H = 300;
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

/** Each: a key (matches demo-sponsors.ts), a mark, and the words. `bg` makes a solid (non-see-through) logo. */
const LOGOS = [
  { key: "harbor-lane", color: "#0b4f8a", accent: "#3fa7d6", mark: "wave", top: "Harbor Lane", bottom: "CREDIT UNION" },
  { key: "maple-main", color: "#9a3412", accent: "#f59e0b", mark: "leaf", top: "Maple & Main", bottom: "ORTHODONTICS" },
  { key: "bluebird", color: "#1e3a8a", accent: "#60a5fa", mark: "circle", top: "Bluebird", bottom: "BAKERY & CAFE", bg: "#fef3c7" },
  { key: "riverside-auto", color: "#111827", accent: "#dc2626", mark: "bars", top: "Riverside", bottom: "AUTO CARE" },
  { key: "pine-hollow", color: "#14532d", accent: "#22c55e", mark: "tree", top: "Pine Hollow", bottom: "PIZZA CO." },
  { key: "summit-music", color: "#4c1d95", accent: "#a78bfa", mark: "peak", top: "Summit", bottom: "MUSIC SUPPLY", bg: "#ffffff" },
  { key: "northgate", color: "#7c2d12", accent: "#fb923c", mark: "square", top: "Northgate", bottom: "HARDWARE" },
];

function mark(kind, c, a) {
  const cx = 150, cy = 150;
  switch (kind) {
    case "wave":
      return `<circle cx="${cx}" cy="${cy}" r="100" fill="${c}"/><path d="M60 165 q30 -40 60 0 t60 0 t60 0" stroke="${a}" stroke-width="18" fill="none" stroke-linecap="round"/><path d="M70 120 q25 -30 50 0 t50 0 t50 0" stroke="#fff" stroke-width="12" fill="none" stroke-linecap="round"/>`;
    case "leaf":
      return `<path d="M150 50 C230 90 240 200 150 250 C60 200 70 90 150 50 Z" fill="${a}"/><path d="M150 80 L150 240" stroke="${c}" stroke-width="12" stroke-linecap="round"/>`;
    case "circle":
      return `<circle cx="${cx}" cy="${cy}" r="100" fill="${a}"/><circle cx="${cx + 20}" cy="${cy - 20}" r="45" fill="${c}"/><path d="M175 135 l40 10 l-40 10 z" fill="#f59e0b"/>`;
    case "bars":
      return `<rect x="55" y="60" width="190" height="180" rx="28" fill="${c}"/><rect x="85" y="170" width="130" height="22" rx="11" fill="${a}"/><rect x="85" y="130" width="100" height="22" rx="11" fill="#fff"/><rect x="85" y="90" width="70" height="22" rx="11" fill="#fff"/>`;
    case "tree":
      return `<path d="M150 40 L240 200 L60 200 Z" fill="${a}"/><path d="M150 90 L215 210 L85 210 Z" fill="${c}"/><rect x="135" y="205" width="30" height="45" fill="${c}"/>`;
    case "peak":
      return `<path d="M40 240 L120 90 L165 160 L200 110 L265 240 Z" fill="${c}"/><path d="M120 90 L145 135 L105 135 Z" fill="${a}"/>`;
    default:
      return `<rect x="60" y="60" width="180" height="180" rx="16" fill="${c}"/><rect x="100" y="100" width="100" height="100" rx="8" fill="${a}"/>`;
  }
}

const svg = (l) => `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
${l.bg ? `<rect width="${W}" height="${H}" fill="${l.bg}"/>` : ""}
${mark(l.mark, l.color, l.accent)}
<text x="290" y="160" font-family="Inter, DejaVu Sans, sans-serif" font-weight="800" font-size="84" fill="${l.color}">${esc(l.top)}</text>
<text x="294" y="225" font-family="Inter, DejaVu Sans, sans-serif" font-weight="600" font-size="44" letter-spacing="6" fill="${l.accent}">${esc(l.bottom)}</text>
</svg>`;

const out = {};
for (const l of LOGOS) {
  // Cropped to the drawing; a solid logo keeps a margin of its own color.
  const trimmed = await sharp(Buffer.from(svg(l))).trim({ threshold: 1 }).toBuffer();
  const img = l.bg
    ? sharp(trimmed).extend({ top: 36, bottom: 36, left: 48, right: 48, background: l.bg }).flatten({ background: l.bg })
    : sharp(trimmed);
  const png = await img.png({ palette: true, colors: 64, compressionLevel: 9 }).toBuffer();
  out[l.key] = png.toString("base64");
  console.log(l.key, png.length, "bytes");
}

const body = `// Made by scripts/make-demo-sponsor-logos.mjs: made-up businesses' logos for demo mode (PNG, base64). Don't edit.
export const DEMO_SPONSOR_LOGOS: Record<string, string> = {
${Object.entries(out).map(([k, v]) => `  "${k}": "${v}",`).join("\n")}
};
`;
writeFileSync(new URL("../src/lib/demo-sponsor-logos.ts", import.meta.url), body);
