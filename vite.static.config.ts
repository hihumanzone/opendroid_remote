import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  publicDir: "public",
  plugins: [react()],
  build: {
    outDir: "dist-static",
    emptyOutDir: true,
    sourcemap: true,
    target: "es2022",
  },
});
