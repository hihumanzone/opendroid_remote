import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";

const rootDir = resolve(".");
const iconsDir = resolve(rootDir, "public/icons");
await mkdir(iconsDir, { recursive: true });

const baseSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="16" fill="#10130f"/>
  <path d="M19 23h26v25a5 5 0 0 1-5 5H24a5 5 0 0 1-5-5V23Z" fill="#c8f85a"/>
  <path d="m23 20-4-7m22 7 4-7" stroke="#c8f85a" stroke-width="4" stroke-linecap="round"/>
  <circle cx="27" cy="31" r="2.5" fill="#10130f"/>
  <circle cx="37" cy="31" r="2.5" fill="#10130f"/>
  <path d="M26 42h12" stroke="#10130f" stroke-width="3" stroke-linecap="round"/>
</svg>`;

// Maskable icon with safe-zone margin (inner icon at ~75% scale centered on background #10130f)
const maskableSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" fill="#10130f"/>
  <g transform="translate(8, 8) scale(0.75)">
    <rect width="64" height="64" rx="16" fill="#10130f"/>
    <path d="M19 23h26v25a5 5 0 0 1-5 5H24a5 5 0 0 1-5-5V23Z" fill="#c8f85a"/>
    <path d="m23 20-4-7m22 7 4-7" stroke="#c8f85a" stroke-width="4" stroke-linecap="round"/>
    <circle cx="27" cy="31" r="2.5" fill="#10130f"/>
    <circle cx="37" cy="31" r="2.5" fill="#10130f"/>
    <path d="M26 42h12" stroke="#10130f" stroke-width="3" stroke-linecap="round"/>
  </g>
</svg>`;

const targets = [
  { file: "icon-32.png", size: 32, svg: baseSvg },
  { file: "icon-192.png", size: 192, svg: baseSvg },
  { file: "icon-512.png", size: 512, svg: baseSvg },
  { file: "icon-512-maskable.png", size: 512, svg: maskableSvg },
  { file: "apple-touch-icon.png", size: 180, svg: baseSvg },
];

for (const target of targets) {
  const outputPath = resolve(iconsDir, target.file);
  await sharp(Buffer.from(target.svg))
    .resize(target.size, target.size)
    .png()
    .toFile(outputPath);
  console.log(`Generated ${target.file} (${target.size}x${target.size})`);
}

console.log("All PWA icons generated successfully!");
