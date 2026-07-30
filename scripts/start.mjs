import { run } from "./process.mjs";

await run("vinext", ["start", ...process.argv.slice(2)], {
  env: {
    ...process.env,
    WRANGLER_LOG_PATH:
      process.env.WRANGLER_LOG_PATH ?? ".wrangler/wrangler.log",
  },
});
