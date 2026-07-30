import { access, readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const workerPath = resolve("dist/server/index.js");
const hostingPath = resolve("dist/.openai/hosting.json");

await Promise.all([access(workerPath), access(hostingPath)]);
JSON.parse(await readFile(hostingPath, "utf8"));

const workerUrl = pathToFileURL(workerPath);
workerUrl.searchParams.set("sites-validation", `${process.pid}-${Date.now()}`);
const worker = await import(workerUrl.href);
if (!worker.default || typeof worker.default.fetch !== "function") {
  throw new Error(
    "dist/server/index.js must export a default object with fetch(request, env, ctx)",
  );
}

console.log(
  "Validated Sites artifact: Worker default.fetch and hosting manifest are present.",
);
