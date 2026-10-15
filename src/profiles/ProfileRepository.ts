import type { Diagnostics } from "../debug/Diagnostics";
import {
  createProfile,
  isGameProfile,
  type GameProfile,
} from "./schema";

const DATABASE_NAME = "opendroid-remote";
const DATABASE_VERSION = 1;
const PROFILE_STORE = "profiles";
const LOCAL_STORAGE_KEY = "opendroid-remote.profiles.v1";

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB failed"));
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(PROFILE_STORE)) {
        database.createObjectStore(PROFILE_STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export class ProfileRepository {
  #memory: GameProfile[] = [];
  readonly #storage: StorageLike | undefined;

  constructor(
    private readonly diagnostics?: Diagnostics,
    storage?: StorageLike,
  ) {
    this.#storage =
      storage ?? (typeof localStorage === "undefined" ? undefined : localStorage);
  }

  async list(): Promise<GameProfile[]> {
    if (typeof indexedDB !== "undefined") {
      try {
        const database = await openDatabase();
        try {
          const transaction = database.transaction(PROFILE_STORE, "readonly");
          const values = await requestResult(
            transaction.objectStore(PROFILE_STORE).getAll(),
          );
          return (values as unknown[])
            .filter(isGameProfile)
            .map((profile) => structuredClone(profile))
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
        } finally {
          database.close();
        }
      } catch (error) {
        this.diagnostics?.warn(
          "profile",
          "indexeddb-list-failed",
          "IndexedDB profile loading failed; using localStorage.",
          error,
        );
      }
    }
    return this.#listLocal();
  }

  async get(id: string): Promise<GameProfile | undefined> {
    if (typeof indexedDB !== "undefined") {
      try {
        const database = await openDatabase();
        try {
          const transaction = database.transaction(PROFILE_STORE, "readonly");
          const value = await requestResult(
            transaction.objectStore(PROFILE_STORE).get(id),
          );
          return isGameProfile(value) ? structuredClone(value) : undefined;
        } finally {
          database.close();
        }
      } catch (error) {
        this.diagnostics?.warn(
          "profile",
          "indexeddb-get-failed",
          "IndexedDB profile lookup failed; using localStorage.",
          error,
        );
      }
    }
    return this.#listLocal().find((profile) => profile.id === id);
  }

  async save(profile: GameProfile): Promise<GameProfile> {
    if (!isGameProfile(profile)) {
      throw new Error("Cannot save an invalid profile");
    }
    const saved = structuredClone({
      ...profile,
      updatedAt: new Date().toISOString(),
    });
    if (typeof indexedDB !== "undefined") {
      try {
        const database = await openDatabase();
        try {
          const transaction = database.transaction(PROFILE_STORE, "readwrite");
          await requestResult(transaction.objectStore(PROFILE_STORE).put(saved));
          this.diagnostics?.debug(
            "profile",
            "profile-saved",
            `Saved profile “${saved.name}”.`,
            { id: saved.id, mappingCount: saved.mappings.length },
          );
          return saved;
        } finally {
          database.close();
        }
      } catch (error) {
        this.diagnostics?.warn(
          "profile",
          "indexeddb-save-failed",
          "IndexedDB profile save failed; using localStorage.",
          error,
        );
      }
    }
    const profiles = this.#listLocal().filter((item) => item.id !== saved.id);
    profiles.push(saved);
    this.#memory = profiles;
    if (this.#storage) {
      try {
        this.#storage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(profiles));
      } catch (error) {
        this.diagnostics?.warn(
          "profile",
          "localstorage-save-failed",
          "IndexedDB profile save failed; local storage save also failed.",
          error,
        );
      }
    }
    return saved;
  }

  async delete(id: string): Promise<void> {
    if (typeof indexedDB !== "undefined") {
      try {
        const database = await openDatabase();
        try {
          const transaction = database.transaction(PROFILE_STORE, "readwrite");
          await requestResult(transaction.objectStore(PROFILE_STORE).delete(id));
          return;
        } finally {
          database.close();
        }
      } catch (error) {
        this.diagnostics?.warn(
          "profile",
          "indexeddb-delete-failed",
          "IndexedDB profile deletion failed; using localStorage.",
          error,
        );
      }
    }
    const profiles = this.#listLocal().filter((profile) => profile.id !== id);
    this.#memory = profiles;
    if (this.#storage) {
      try {
        this.#storage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(profiles));
      } catch (error) {
        this.diagnostics?.warn(
          "profile",
          "localstorage-delete-failed",
          "IndexedDB deletion failed; local storage deletion also failed.",
          error,
        );
      }
    }
  }

  async ensureDefault(): Promise<GameProfile> {
    const profiles = await this.list();
    if (profiles[0]) return profiles[0];
    return this.save(createProfile("Default controls"));
  }

  async findByPackage(packageName: string): Promise<GameProfile | undefined> {
    const profiles = await this.list();
    const target = packageName.trim().toLowerCase();
    return profiles.find(
      (p) => p.game?.packageName && p.game.packageName.toLowerCase().includes(target),
    );
  }

  async getDefaultProfile(defaultId?: string): Promise<GameProfile> {
    const profiles = await this.list();
    if (defaultId) {
      const explicit = profiles.find((p) => p.id === defaultId);
      if (explicit) return explicit;
    }
    const byName = profiles.find((p) => p.name.toLowerCase().includes("default"));
    if (byName) return byName;
    if (profiles[0]) return profiles[0];
    return this.ensureDefault();
  }

  #listLocal(): GameProfile[] {
    if (this.#storage) {
      try {
        const raw = this.#storage.getItem(LOCAL_STORAGE_KEY);
        if (raw) {
          const parsed: unknown = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            const list = parsed
              .filter(isGameProfile)
              .map((profile) => structuredClone(profile))
              .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
            this.#memory = list;
            return list;
          }
        }
      } catch (error) {
        this.diagnostics?.warn(
          "profile",
          "localstorage-read-failed",
          "Stored local profiles could not be parsed.",
          error,
        );
      }
    }
    return this.#memory
      .map((p) => structuredClone(p))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
}

