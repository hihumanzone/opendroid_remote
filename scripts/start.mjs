import { run } from "./process.mjs";

const isVercel = Boolean(process.env.VERCEL);
const isNextTarget = isVercel || process.argv.includes("--next");

if (isNextTarget) {
  const args = process.argv.slice(2).filter((arg) => arg !== "--next");
  await run("next", ["start", ...args]);
} else {
  await run("vinext", ["start", ...process.argv.slice(2)], {
    env: {
      ...process.env,
      WRANGLER_LOG_PATH:
        process.env.WRANGLER_LOG_PATH ?? ".wrangler/wrangler.log",
    },
  });
}
