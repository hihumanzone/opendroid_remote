import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Brand Logo & Consistency", () => {
  const rootDir = resolve(__dirname, "..");
  const faviconPath = resolve(rootDir, "public/favicon.svg");
  const uiIconsPath = resolve(rootDir, "src/ui/icons/UiIcons.tsx");
  const connectionChromePath = resolve(
    rootDir,
    "src/ui/ConnectionChrome.tsx",
  );
  const globalsCssPath = resolve(rootDir, "app/globals.css");

  it("favicon.svg contains canonical brand mark elements", () => {
    const faviconContent = readFileSync(faviconPath, "utf8");
    expect(faviconContent).toContain('viewBox="0 0 64 64"');
    expect(faviconContent).toContain('fill="#10130f"');
    expect(faviconContent).toContain('fill="#c8f85a"');
    expect(faviconContent).toContain('stroke="#c8f85a"');
    expect(faviconContent).toContain(
      'd="M19 23h26v25a5 5 0 0 1-5 5H24a5 5 0 0 1-5-5V23Z"',
    );
    expect(faviconContent).toContain('d="m23 20-4-7m22 7 4-7"');
  });

  it("UiIcons exports IconOpenDroid matching the favicon SVG paths and colors", () => {
    const uiIconsContent = readFileSync(uiIconsPath, "utf8");
    expect(uiIconsContent).toContain("export function IconOpenDroid");
    expect(uiIconsContent).toContain('viewBox="0 0 64 64"');
    expect(uiIconsContent).toContain('fill="#10130f"');
    expect(uiIconsContent).toContain('fill="#c8f85a"');
    expect(uiIconsContent).toContain('stroke="#c8f85a"');
    expect(uiIconsContent).toContain(
      'd="M19 23h26v25a5 5 0 0 1-5 5H24a5 5 0 0 1-5-5V23Z"',
    );
    expect(uiIconsContent).toContain('d="m23 20-4-7m22 7 4-7"');
  });

  it("ConnectionChrome renders IconOpenDroid in .brand-mark instead of 'OD' text", () => {
    const connectionChromeContent = readFileSync(
      connectionChromePath,
      "utf8",
    );
    expect(connectionChromeContent).toContain("IconOpenDroid");
    expect(connectionChromeContent).toContain(
      '<span className="brand-mark" aria-hidden="true">\n            <IconOpenDroid size={34} />\n          </span>',
    );
    expect(connectionChromeContent).not.toMatch(
      /<span className="brand-mark"[^>]*>\s*OD\s*<\/span>/,
    );
  });

  it("globals.css removes legacy fake antenna pseudo-elements and text styling on .brand-mark", () => {
    const cssContent = readFileSync(globalsCssPath, "utf8");
    expect(cssContent).not.toContain(".brand-mark::before");
    expect(cssContent).not.toContain(".brand-mark::after");
    expect(cssContent).toContain(".brand-mark {");
    expect(cssContent).toContain(".brand-mark svg {");

    const brandMarkBlock = cssContent.match(/\.brand-mark\s*\{([^}]+)\}/)?.[1] ?? "";
    expect(brandMarkBlock).not.toContain("color:");
    expect(brandMarkBlock).not.toContain("font-size:");
    expect(brandMarkBlock).not.toContain("letter-spacing:");
    expect(brandMarkBlock).not.toContain("linear-gradient");
  });
});
