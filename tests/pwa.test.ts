import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { capabilityChecks } from "../src/capabilities/browserCapabilities";
import { registerServiceWorker } from "../src/pwa/registerServiceWorker";

describe("PWA Manifest", () => {
  const rootDir = resolve(__dirname, "..");
  const manifestPath = resolve(rootDir, "public/manifest.webmanifest");
  const manifestJsonPath = resolve(rootDir, "public/manifest.json");

  it("manifest.webmanifest exists and is valid JSON", () => {
    expect(existsSync(manifestPath)).toBe(true);
    const content = JSON.parse(readFileSync(manifestPath, "utf8"));
    expect(content.name).toBe("OpenDroid Remote");
    expect(content.short_name).toBe("OpenDroid");
    expect(content.display).toBe("standalone");
    expect(content.start_url).toBe("./");
    expect(content.theme_color).toBe("#10130f");
    expect(content.background_color).toBe("#10130f");
    expect(Array.isArray(content.icons)).toBe(true);
    expect(content.icons.length).toBeGreaterThanOrEqual(4);
  });

  it("manifest.json alias exists and matches manifest.webmanifest", () => {
    expect(existsSync(manifestJsonPath)).toBe(true);
    const webmanifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    const json = JSON.parse(readFileSync(manifestJsonPath, "utf8"));
    expect(json).toEqual(webmanifest);
  });

  it("all declared icons exist on disk in public directory", () => {
    const content = JSON.parse(readFileSync(manifestPath, "utf8"));
    for (const icon of content.icons) {
      const iconPath = resolve(rootDir, "public", icon.src.replace(/^\.\//, ""));
      expect(existsSync(iconPath), `Icon file ${icon.src} should exist at ${iconPath}`).toBe(true);
    }
  });

  it("has maskable icon for Android adaptive launcher icons", () => {
    const content = JSON.parse(readFileSync(manifestPath, "utf8"));
    const maskable = content.icons.find((i: { purpose?: string }) => i.purpose === "maskable");
    expect(maskable).toBeDefined();
  });

  it("declares window-controls-overlay in display_override for seamless titlebar integration", () => {
    const content = JSON.parse(readFileSync(manifestPath, "utf8"));
    expect(Array.isArray(content.display_override)).toBe(true);
    expect(content.display_override).toContain("window-controls-overlay");
  });
});

describe("Window Controls Overlay & Title Bar Layout", () => {
  const rootDir = resolve(__dirname, "..");
  const cssPath = resolve(rootDir, "app/globals.css");

  it("globals.css defines WCO and safe area geometry variables on :root", () => {
    const css = readFileSync(cssPath, "utf8");
    expect(css).toContain("--titlebar-left");
    expect(css).toContain("--titlebar-right");
    expect(css).toContain("--titlebar-top");
    expect(css).toContain("--titlebar-height");
    expect(css).toContain("--wco-right");
    expect(css).toContain("--wco-left");
  });

  it("globals.css styles .topbar with safe insets and draggable window region", () => {
    const css = readFileSync(cssPath, "utf8");
    expect(css).toContain("padding-left: max(var(--titlebar-left), var(--wco-left, 0px));");
    expect(css).toContain("padding-right: max(var(--titlebar-right), var(--wco-right, 0px));");
    expect(css).toContain("app-region: drag;");
  });

  it("globals.css marks interactive elements inside .topbar as no-drag", () => {
    const css = readFileSync(cssPath, "utf8");
    expect(css).toContain("app-region: no-drag;");
    expect(css).toContain(".topbar button");
    expect(css).toContain(".topbar a");
    expect(css).toContain(".topbar .custom-select-container");
  });

  it("globals.css defines display-mode: window-controls-overlay media query", () => {
    const css = readFileSync(cssPath, "utf8");
    expect(css).toContain("@media (display-mode: window-controls-overlay)");
  });
});

describe("Service Worker", () => {
  const rootDir = resolve(__dirname, "..");
  const swPath = resolve(rootDir, "public/sw.js");

  it("sw.js exists and precaches critical shell and scrcpy binary", () => {
    expect(existsSync(swPath)).toBe(true);
    const swContent = readFileSync(swPath, "utf8");
    expect(swContent).toContain("CACHE_NAME");
    expect(swContent).toContain("vendor/scrcpy-server-v3.3.3");
    expect(swContent).toContain("manifest.webmanifest");
    expect(swContent).toContain("SKIP_WAITING");
    expect(swContent).toContain("fetchWithTimeout");
  });

  it("returns supported: false when running outside secure browser context", async () => {
    const result = await registerServiceWorker();
    expect(result.supported).toBe(false);
  });
});

describe("PWA Browser Capabilities", () => {
  it("includes serviceWorker in capability check list", () => {
    const checks = capabilityChecks({
      secureContext: true,
      webUsb: true,
      webCodecs: true,
      webAudio: true,
      webGl: true,
      pointerEvents: true,
      pointerLock: true,
      fullscreen: true,
      keyboardLock: true,
      clipboardRead: true,
      clipboardWrite: true,
      indexedDb: true,
      cryptoSubtle: true,
      serviceWorker: true,
    });
    const swCheck = checks.find((c) => c.id === "serviceWorker");
    expect(swCheck).toBeDefined();
    expect(swCheck?.supported).toBe(true);
    expect(swCheck?.required).toBe(false);
  });
});
