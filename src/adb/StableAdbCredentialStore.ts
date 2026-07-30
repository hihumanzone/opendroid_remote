import type {
  AdbCredentialStore,
  AdbPrivateKey,
} from "@yume-chan/adb";

const DATABASE_NAME = "opendroid-remote-adb-identity";
const DATABASE_VERSION = 1;
const IDENTITY_STORE = "identity";
const PRIMARY_IDENTITY_KEY = "primary";
const LOCAL_STORAGE_KEY = "opendroid-remote.adb-identity.v1";
const IDENTITY_SCHEMA_VERSION = 1;

interface StoredIdentity {
  id: typeof PRIMARY_IDENTITY_KEY;
  schemaVersion: typeof IDENTITY_SCHEMA_VERSION;
  keys: Uint8Array[];
}

interface SerializedIdentity {
  schemaVersion: typeof IDENTITY_SCHEMA_VERSION;
  keys: string[];
}

export interface AdbIdentityPersistence {
  load(): Promise<readonly Uint8Array[]>;
  save(keys: readonly Uint8Array[]): Promise<void>;
}

function cloneBytes(value: Uint8Array): Uint8Array {
  return new Uint8Array(value);
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
    binary += String.fromCharCode(
      ...bytes.subarray(offset, offset + chunkSize),
    );
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function generatePrivateKey(): Promise<AdbPrivateKey> {
  if (!globalThis.crypto?.subtle) {
    throw new Error("Web Crypto is required to create an ADB identity");
  }
  const { privateKey } = await globalThis.crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([0x01, 0x00, 0x01]),
      hash: "SHA-1",
    },
    true,
    ["sign", "verify"],
  );
  return {
    buffer: new Uint8Array(
      await globalThis.crypto.subtle.exportKey("pkcs8", privateKey),
    ),
  };
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("ADB identity request failed"));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () =>
      reject(
        transaction.error ?? new Error("ADB identity transaction aborted"),
      );
    transaction.onerror = () =>
      reject(
        transaction.error ?? new Error("ADB identity transaction failed"),
      );
  });
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onerror = () =>
      reject(request.error ?? new Error("ADB identity database failed"));
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(IDENTITY_STORE)) {
        database.createObjectStore(IDENTITY_STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => database.close();
      resolve(database);
    };
  });
}

function normalizeStoredBytes(value: unknown): Uint8Array | undefined {
  if (value instanceof Uint8Array && value.byteLength > 0) {
    return cloneBytes(value);
  }
  if (value instanceof ArrayBuffer && value.byteLength > 0) {
    return new Uint8Array(value.slice(0));
  }
  return undefined;
}

function normalizeStoredKeys(value: unknown): Uint8Array[] {
  const source =
    value &&
    typeof value === "object" &&
    "keys" in value &&
    Array.isArray((value as { keys: unknown }).keys)
      ? (value as { keys: unknown[] }).keys
      : value &&
          typeof value === "object" &&
          "pkcs8" in value
        ? [(value as { pkcs8: unknown }).pkcs8]
        : [];
  const result: Uint8Array[] = [];
  for (const item of source) {
    const bytes = normalizeStoredBytes(item);
    if (
      bytes &&
      !result.some((current) => bytesEqual(current, bytes))
    ) {
      result.push(bytes);
    }
  }
  return result.slice(0, 32);
}

export function mergeAdbIdentityKeys(
  ...sources: readonly (readonly Uint8Array[])[]
): Uint8Array[] {
  const result: Uint8Array[] = [];
  for (const source of sources) {
    for (const item of source) {
      const bytes = normalizeStoredBytes(item);
      if (
        bytes &&
        !result.some((current) => bytesEqual(current, bytes))
      ) {
        result.push(bytes);
      }
    }
  }
  return result.slice(0, 32);
}

/**
 * Mirrors the browser ADB identity into a dedicated IndexedDB database and
 * localStorage. The second copy is intentional: some Chromium storage cleanup
 * paths have historically evicted one storage bucket before the other.
 */
export class BrowserAdbIdentityPersistence
  implements AdbIdentityPersistence
{
  async load(): Promise<readonly Uint8Array[]> {
    let indexedDbValue: Uint8Array[] = [];
    if (typeof indexedDB !== "undefined") {
      try {
        const database = await openDatabase();
        try {
          const transaction = database.transaction(
            IDENTITY_STORE,
            "readonly",
          );
          const stored = await requestResult(
            transaction.objectStore(IDENTITY_STORE).get(PRIMARY_IDENTITY_KEY),
          );
          indexedDbValue = normalizeStoredKeys(stored);
        } finally {
          database.close();
        }
      } catch {
        // localStorage remains a valid recovery copy.
      }
    }

    let localValue: Uint8Array[] = [];
    if (typeof localStorage !== "undefined") {
      try {
        const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as Partial<SerializedIdentity>;
          if (parsed.schemaVersion === IDENTITY_SCHEMA_VERSION) {
            const encodedKeys = Array.isArray(parsed.keys)
              ? parsed.keys
              : typeof (parsed as { pkcs8?: unknown }).pkcs8 === "string"
                ? [(parsed as { pkcs8: string }).pkcs8]
                : [];
            localValue = normalizeStoredKeys({
              keys: encodedKeys.map((item) =>
                typeof item === "string"
                  ? base64ToBytes(item)
                  : new Uint8Array(),
              ),
            });
          }
        }
      } catch {
        // A damaged backup must never cause a fresh key to replace a valid one.
      }
    }

    const recovered = mergeAdbIdentityKeys(indexedDbValue, localValue);
    if (recovered.length > 0) {
      // Repair missing or divergent mirrors asynchronously. A trusted key must
      // never be discarded just because one browser storage backend is stale.
      if (
        indexedDbValue.length !== recovered.length ||
        localValue.length !== recovered.length ||
        recovered.some(
          (key, index) =>
            !indexedDbValue[index] ||
            !bytesEqual(key, indexedDbValue[index]) ||
            !localValue[index] ||
            !bytesEqual(key, localValue[index]),
        )
      ) {
        void this.save(recovered).catch(() => {});
      }
      return recovered;
    }
    return [];
  }

  async save(keys: readonly Uint8Array[]): Promise<void> {
    const bytes = normalizeStoredKeys({ keys });
    if (bytes.length === 0) return;
    const writes: Promise<void>[] = [];

    if (typeof indexedDB !== "undefined") {
      writes.push(
        (async () => {
          const database = await openDatabase();
          try {
            const transaction = database.transaction(
              IDENTITY_STORE,
              "readwrite",
            );
            const value: StoredIdentity = {
              id: PRIMARY_IDENTITY_KEY,
              schemaVersion: IDENTITY_SCHEMA_VERSION,
              keys: bytes,
            };
            const committed = transactionDone(transaction);
            await requestResult(
              transaction.objectStore(IDENTITY_STORE).put(value),
            );
            await committed;
          } finally {
            database.close();
          }
        })(),
      );
    }

    if (typeof localStorage !== "undefined") {
      writes.push(
        Promise.resolve().then(() => {
          const value: SerializedIdentity = {
            schemaVersion: IDENTITY_SCHEMA_VERSION,
            keys: bytes.map(bytesToBase64),
          };
          localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(value));
        }),
      );
    }

    if (writes.length === 0) return;
    const results = await Promise.allSettled(writes);
    if (results.every((result) => result.status === "rejected")) {
      throw new Error("The browser could not persist the ADB identity");
    }
  }
}

export interface StableAdbCredentialStoreOptions {
  persistence?: AdbIdentityPersistence;
  identityName?: string;
}

/**
 * Keeps one primary RSA identity stable for the lifetime of the HTTPS origin.
 *
 * Existing keys from ya-webadb's legacy `Tango` store are retained and tried
 * after the primary key. This lets an Android device that trusted any previous
 * key authenticate by signature without another dialog, while all future
 * public-key prompts consistently present the same primary identity.
 */
export class StableAdbCredentialStore implements AdbCredentialStore {
  readonly #persistence: AdbIdentityPersistence;
  readonly #identityName: string;
  #keysPromise?: Promise<AdbPrivateKey[]>;
  #generationPromise?: Promise<AdbPrivateKey>;

  constructor(
    private readonly delegate: AdbCredentialStore,
    options: StableAdbCredentialStoreOptions = {},
  ) {
    this.#persistence =
      options.persistence ?? new BrowserAdbIdentityPersistence();
    this.#identityName =
      options.identityName ??
      `OpenDroid Remote@${
        typeof location === "undefined" ? "browser" : location.hostname
      }`;
  }

  async *iterateKeys(): AsyncGenerator<AdbPrivateKey, void, void> {
    for (const key of await this.#loadKeys()) {
      yield key;
    }
  }

  async generateKey(): Promise<AdbPrivateKey> {
    const keys = await this.#loadKeys();
    if (keys[0]) return keys[0];

    this.#generationPromise ??= Promise.resolve()
      .then(async () => {
        try {
          return await this.delegate.generateKey();
        } catch {
          // The upstream web store requires IndexedDB. Generate directly when
          // it is unavailable so the localStorage identity mirror can still
          // provide stable browser-only authentication.
          return generatePrivateKey();
        }
      })
      .then(async (key) => {
        const primary = this.#namedKey(key.buffer);
        keys.push(primary);
        await this.#persistence
          .save(keys.map((item) => item.buffer))
          .catch(() => {});
        return primary;
      });

    try {
      return await this.#generationPromise;
    } finally {
      this.#generationPromise = undefined;
    }
  }

  #namedKey(buffer: Uint8Array): AdbPrivateKey {
    return {
      buffer: cloneBytes(buffer),
      name: this.#identityName,
    };
  }

  #loadKeys(): Promise<AdbPrivateKey[]> {
    this.#keysPromise ??= (async () => {
      const keys: AdbPrivateKey[] = [];
      const persisted = await this.#persistence.load().catch(() => []);
      for (const buffer of persisted) {
        if (buffer.byteLength > 0) keys.push(this.#namedKey(buffer));
      }

      try {
        for await (const key of this.delegate.iterateKeys()) {
          if (
            key.buffer.byteLength > 0 &&
            !keys.some((current) =>
              bytesEqual(current.buffer, key.buffer),
            )
          ) {
            keys.push(this.#namedKey(key.buffer));
          }
        }
      } catch {
        // A valid dedicated identity remains usable if the legacy store fails.
      }

      if (
        keys.length > 0 &&
        (persisted.length !== keys.length ||
          keys.some(
            (key, index) =>
              !persisted[index] ||
              !bytesEqual(key.buffer, persisted[index]),
          ))
      ) {
        await this.#persistence
          .save(keys.map((item) => item.buffer))
          .catch(() => {});
      }
      return keys;
    })();
    return this.#keysPromise;
  }
}
