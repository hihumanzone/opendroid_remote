import type { ImportPreferences } from "../settings/AppSettings";
import {
  createId,
  parseProfileJson,
  type GameProfile,
} from "./schema";

export interface ProfileImportFile {
  name: string;
  type: string;
  size: number;
  text(): Promise<string>;
}

export interface ProfileImportStore {
  list(): Promise<GameProfile[]>;
  save(profile: GameProfile): Promise<GameProfile>;
}

export interface ProfileImportResult {
  imported: GameProfile[];
  skipped: number;
  failures: string[];
}

export interface ProfileImportDependencies {
  createId(prefix: string): string;
  now(): string;
}

const DEFAULT_DEPENDENCIES: ProfileImportDependencies = {
  createId,
  now: () => new Date().toISOString(),
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isJsonFile(file: ProfileImportFile): boolean {
  const mimeType = file.type.toLowerCase().split(";", 1)[0];
  return (
    file.name.toLowerCase().endsWith(".json") ||
    mimeType === "application/json"
  );
}

function createImportedCopy(
  profile: GameProfile,
  dependencies: ProfileImportDependencies,
): GameProfile {
  const timestamp = dependencies.now();
  return {
    ...structuredClone(profile),
    id: dependencies.createId("profile"),
    name: `${profile.name} imported`,
    createdAt: timestamp,
    updatedAt: timestamp,
    mappings: profile.mappings.map((mapping) => ({
      ...mapping,
      id: dependencies.createId("mapping"),
    })),
  };
}

/**
 * Validates and persists a batch in file order. The known-ID set is updated
 * after every save, so duplicate IDs inside one batch obey the same collision
 * policy as IDs already stored in the browser.
 */
export async function importProfileFiles(
  files: readonly ProfileImportFile[],
  store: ProfileImportStore,
  preferences: ImportPreferences,
  dependencies: ProfileImportDependencies = DEFAULT_DEPENDENCIES,
): Promise<ProfileImportResult> {
  const maximumBytes = preferences.maxFileSizeMb * 1024 * 1024;
  let knownProfiles = await store.list();
  const result: ProfileImportResult = {
    imported: [],
    skipped: 0,
    failures: [],
  };

  for (const file of files) {
    try {
      if (!isJsonFile(file)) {
        throw new Error("only JSON profile files are accepted");
      }
      if (file.size > maximumBytes) {
        throw new Error(
          `file exceeds the ${preferences.maxFileSizeMb} MB limit`,
        );
      }
      const imported = parseProfileJson(await file.text());
      const collision = knownProfiles.some(
        (profile) => profile.id === imported.id,
      );
      if (collision && preferences.conflictStrategy === "skip") {
        result.skipped += 1;
        continue;
      }
      const candidate =
        collision && preferences.conflictStrategy === "copy"
          ? createImportedCopy(imported, dependencies)
          : imported;
      const saved = await store.save(candidate);
      knownProfiles = [
        saved,
        ...knownProfiles.filter((profile) => profile.id !== saved.id),
      ];
      result.imported.push(saved);
    } catch (error) {
      result.failures.push(`${file.name}: ${errorMessage(error)}`);
      if (preferences.errorStrategy === "stop") break;
    }
  }
  return result;
}
