import { run } from "./process.mjs";
import { rm } from "node:fs/promises";
import { resolve } from "node:path";

const isVercel = Boolean(process.env.VERCEL);
const isNextTarget = isVercel || process.argv.includes("--next");

if (isNextTarget) {
  console.log("Building application for Next.js / Vercel target…");
  await run("next", ["build"]);
  console.log("Next.js build completed (.next/).");
} else {
  console.log("Building the hosted application…");
  await rm(resolve("dist"), { recursive: true, force: true });
  await run("vinext", ["build"], {
    env: {
      ...process.env,
      WRANGLER_LOG_PATH:
        process.env.WRANGLER_LOG_PATH ?? ".wrangler/wrangler.log",
    },
  });
  await import("./validate-artifact.mjs");

  console.log("Building the portable static application…");
  await rm(resolve("dist-static"), { recursive: true, force: true });
  await run("vite", ["build", "--config", "vite.static.config.ts"]);
  console.log("Production builds completed: dist/ and dist-static/.");
}
