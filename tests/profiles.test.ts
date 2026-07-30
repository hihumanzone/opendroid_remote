import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import {
  PROFILE_SCHEMA_VERSION,
  createMapping,
  createProfile,
  isGameProfile,
  parseProfileJson,
  serializeProfile,
} from "../src/profiles/schema";

describe("profile serialization", () => {
  it("passes unmapped keys through in new profiles by default", () => {
    expect(createProfile().settings.exclusiveInput).toBe(false);
  });

  it("round-trips every mapping type without losing normalized coordinates", () => {
    const profile = createProfile("All controls");
    profile.mappings = (
      [
        "tap",
        "hold",
        "repeat",
        "swipe",
        "joystick",
        "mouse-button",
        "mouse-look",
      ] as const
    ).map((type, index) =>
      createMapping(type, { x: (index + 1) / 10, y: 1 - (index + 1) / 10 }),
    );
    const parsed = parseProfileJson(serializeProfile(profile));
    expect(parsed).toEqual(profile);
    expect(parsed.schemaVersion).toBe(PROFILE_SCHEMA_VERSION);
  });

  it("rejects malformed, unsupported, and out-of-range data", () => {
    const profile = createProfile();
    expect(() =>
      parseProfileJson(JSON.stringify({ ...profile, schemaVersion: 99 })),
    ).toThrow(/schema version 1/);
    expect(() =>
      parseProfileJson(
        JSON.stringify({
          ...profile,
          mappings: [
            {
              ...createMapping("tap"),
              position: { x: 2, y: 0.5 },
            },
          ],
        }),
      ),
    ).toThrow(/schema version 1/);
    expect(() => parseProfileJson("{")).toThrow(/valid JSON/);
  });

  it("validates the shipped example profile", async () => {
    const json = await readFile(
      new URL("../examples/profiles/battle-royale.json", import.meta.url),
      "utf8",
    );
    const profile = parseProfileJson(json);
    expect(isGameProfile(profile)).toBe(true);
    expect(profile.reference.orientation).toBe("landscape");
    expect(profile.mappings.some((mapping) => mapping.type === "joystick")).toBe(
      true,
    );
  });
});
