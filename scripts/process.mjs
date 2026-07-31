import { spawn } from "node:child_process";
import { resolve } from "node:path";

export function executable(name) {
  return resolve(
    "node_modules",
    ".bin",
    process.platform === "win32" ? `${name}.cmd` : name,
  );
}

export function run(name, args = [], options = {}) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(executable(name), args, {
      stdio: "inherit",
      shell: process.platform === "win32",
      ...options,
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolveRun();
      } else {
        reject(
          new Error(
            `${name} exited with ${signal ? `signal ${signal}` : `code ${code}`}`,
          ),
        );
      }
    });
  });
}
