import { describe, expect, it } from "vitest";

import { importProfileFiles } from "../src/profiles/ProfileImporter";
import {
  createMapping,
  createProfile,
  serializeProfile,
  type GameProfile,
} from "../src/profiles/schema";
import type { ImportPreferences } from "../src/settings/AppSettings";

class MemoryProfileStore {
  readonly profiles = new Map<string, GameProfile>();

  constructor(initial: GameProfile[] = []) {
    for (const profile of initial) this.profiles.set(profile.id, profile);
  }

  async list() {
    return [...this.profiles.values()].map((profile) =>
      structuredClone(profile),
    );
  }

  async save(profile: GameProfile) {
    const saved = structuredClone(profile);
    this.profiles.set(saved.id, saved);
    return saved;
  }
}

function file(
  name: string,
  content: string,
  type = "application/json",
) {
  return {
    name,
    type,
    size: new TextEncoder().encode(content).byteLength,
    async text() {
      return content;
    },
  };
}

const preferences: ImportPreferences = {
  conflictStrategy: "copy",
  activateAfterImport: true,
  errorStrategy: "continue",
  maxFileSizeMb: 2,
};

describe("profile batch import", () => {
  it("creates independent identities and timestamps for copied collisions", async () => {
    const existing = createProfile("Existing");
    existing.mappings = [createMapping("hold")];
    const store = new MemoryProfileStore([existing]);
    let sequence = 0;
    const result = await importProfileFiles(
      [file("controls.json", serializeProfile(existing))],
      store,
      preferences,
      {
        createId: (prefix) => `${prefix}-${++sequence}`,
        now: () => "2030-01-02T03:04:05.000Z",
      },
    );

    expect(result.failures).toEqual([]);
    expect(result.imported[0]).toMatchObject({
      id: "profile-1",
      name: "Existing imported",
      createdAt: "2030-01-02T03:04:05.000Z",
      updatedAt: "2030-01-02T03:04:05.000Z",
    });
    expect(result.imported[0]!.id).not.toBe(existing.id);
    expect(result.imported[0]!.mappings[0]!.id).toBe("mapping-2");
  });

  it("applies collision rules to duplicate IDs within the same batch", async () => {
    const imported = createProfile("Repeated");
    const store = new MemoryProfileStore();
    const skipPreferences = {
      ...preferences,
      conflictStrategy: "skip" as const,
    };
    const content = serializeProfile(imported);
    const result = await importProfileFiles(
      [file("first.json", content), file("second.json", content)],
      store,
      skipPreferences,
    );

    expect(result.imported).toHaveLength(1);
    expect(result.skipped).toBe(1);
    expect(store.profiles.size).toBe(1);
  });

  it("enforces file handling and stops on the first failure when configured", async () => {
    const valid = createProfile("Valid");
    const store = new MemoryProfileStore();
    const result = await importProfileFiles(
      [
        file("notes.txt", "not json", "text/plain"),
        file("valid.json", serializeProfile(valid)),
      ],
      store,
      { ...preferences, errorStrategy: "stop" },
    );

    expect(result.failures).toEqual([
      "notes.txt: only JSON profile files are accepted",
    ]);
    expect(result.imported).toEqual([]);
    expect(store.profiles.size).toBe(0);
  });
});
