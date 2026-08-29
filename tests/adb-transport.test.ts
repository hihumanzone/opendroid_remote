import type {
  Adb,
  AdbCredentialStore,
  AdbDaemonTransport,
  AdbPrivateKey,
} from "@yume-chan/adb";
import { AdbAuthType, AdbCommand } from "@yume-chan/adb";
import type { AdbDaemonWebUsbDevice } from "@yume-chan/adb-daemon-webusb";
import { describe, expect, it, vi } from "vitest";

import {
  StableAdbCredentialStore,
  mergeAdbIdentityKeys,
  type AdbIdentityPersistence,
} from "../src/adb/StableAdbCredentialStore";
import { WebUsbAdbTransport } from "../src/adb/WebUsbAdbTransport";
import {
  createDeviceDescriptor,
  mergeDeviceDescriptors,
} from "../src/adb/deviceIdentity";
import { Diagnostics } from "../src/debug/Diagnostics";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function fakeUsbDevice(
  serial: string,
  name = "SAMSUNG_android",
  usbSerial: string | null = serial,
  androidSerial = serial,
) {
  const raw = {
    vendorId: 0x04e8,
    productId: 0x6860,
    serialNumber: usbSerial ?? undefined,
    opened: false,
    close: vi.fn(async () => {
      raw.opened = false;
    }),
  };
  const connect = vi.fn(async () => {
    raw.opened = true;
    return { androidSerial };
  });
  return {
    serial,
    name,
    raw,
    connect,
  } as unknown as AdbDaemonWebUsbDevice;
}

function fakeAdb(serial: string, model: string) {
  return {
    serial,
    maxPayloadSize: 1_048_576,
    banner: {
      product: model,
      model,
      device: model,
      features: [],
    },
    disconnected: new Promise<void>(() => {}),
    getProp: vi.fn(async () => serial),
    close: vi.fn(async () => {}),
  } as unknown as Adb;
}

const EMPTY_CREDENTIAL_STORE: AdbCredentialStore = {
  async generateKey() {
    return { buffer: new Uint8Array([1]) };
  },
  *iterateKeys() {
    // No keys are required because transport authentication is stubbed.
  },
};

async function createValidPrivateKey(): Promise<AdbPrivateKey> {
  const { privateKey } = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-1",
    },
    true,
    ["sign", "verify"],
  );
  return {
    buffer: new Uint8Array(
      await crypto.subtle.exportKey("pkcs8", privateKey),
    ),
  };
}

describe("ADB device identity", () => {
  it("uses serial numbers as keys and keeps identical names distinguishable", () => {
    const first = createDeviceDescriptor({
      serial: "R58N100000A",
      name: "SAMSUNG_android",
      vendorId: 1,
      productId: 2,
    });
    const second = createDeviceDescriptor({
      serial: "R58N100000B",
      name: "SAMSUNG_android",
      vendorId: 1,
      productId: 2,
    });

    const merged = mergeDeviceDescriptors([first], [second]);
    expect(merged).toHaveLength(2);
    expect(merged.map((item) => item.serial)).toEqual([
      "R58N100000A",
      "R58N100000B",
    ]);
    expect(merged[0]?.label).toContain("R58N100000A");
    expect(merged[1]?.label).toContain("R58N100000B");
  });

  it("preserves a discovered model when a later USB enumeration has less detail", () => {
    const connected = createDeviceDescriptor({
      serial: "ABC123",
      name: "Android",
      model: "Pixel Test",
      vendorId: 1,
      productId: 2,
    });
    const enumerated = createDeviceDescriptor({
      serial: "ABC123",
      name: "Android",
      vendorId: 1,
      productId: 2,
    });

    expect(mergeDeviceDescriptors([connected], [enumerated])[0]).toMatchObject({
      serial: "ABC123",
      model: "Pixel Test",
      label: "Pixel Test · ABC123",
    });
  });
});

describe("StableAdbCredentialStore", () => {
  it("retains trusted keys from divergent browser storage mirrors", () => {
    const merged = mergeAdbIdentityKeys(
      [new Uint8Array([1, 2, 3])],
      [new Uint8Array([4, 5, 6]), new Uint8Array([1, 2, 3])],
    );

    expect(merged.map((key) => [...key])).toEqual([
      [1, 2, 3],
      [4, 5, 6],
    ]);
  });

  it("serializes first-key generation and reuses the resulting key", async () => {
    const key: AdbPrivateKey = { buffer: new Uint8Array([4, 2]) };
    const generateKey = vi.fn(async () => key);
    const delegate: AdbCredentialStore = {
      generateKey,
      *iterateKeys() {
        // Start with an empty persistent store.
      },
    };
    let persisted: Uint8Array[] = [];
    const persistence: AdbIdentityPersistence = {
      async load() {
        return persisted;
      },
      async save(values) {
        persisted = values.map((value) => new Uint8Array(value));
      },
    };
    const store = new StableAdbCredentialStore(delegate, {
      persistence,
      identityName: "OpenDroid Remote@test",
    });

    const [first, second] = await Promise.all([
      store.generateKey(),
      store.generateKey(),
    ]);
    const third = await store.generateKey();
    const iterated: AdbPrivateKey[] = [];
    for await (const item of store.iterateKeys()) iterated.push(item);

    expect([...first.buffer]).toEqual([4, 2]);
    expect(second).toBe(first);
    expect(third).toBe(first);
    expect(iterated).toEqual([first]);
    expect(first.name).toBe("OpenDroid Remote@test");
    expect(generateKey).toHaveBeenCalledTimes(1);
    expect([...persisted[0]!]).toEqual([4, 2]);
  });

  it("migrates a legacy key and restores the same identity in a new store", async () => {
    let persisted: Uint8Array[] = [];
    const persistence: AdbIdentityPersistence = {
      async load() {
        return persisted.map((value) => new Uint8Array(value));
      },
      async save(values) {
        persisted = values.map((value) => new Uint8Array(value));
      },
    };
    const legacyKey: AdbPrivateKey = {
      buffer: new Uint8Array([9, 8, 7]),
    };
    const legacy: AdbCredentialStore = {
      async generateKey() {
        throw new Error("must not generate");
      },
      *iterateKeys() {
        yield legacyKey;
      },
    };
    const firstStore = new StableAdbCredentialStore(legacy, { persistence });
    const firstKeys: AdbPrivateKey[] = [];
    for await (const key of firstStore.iterateKeys()) firstKeys.push(key);

    const emptyDelegate: AdbCredentialStore = {
      async generateKey() {
        throw new Error("must not generate");
      },
      *iterateKeys() {},
    };
    const restoredStore = new StableAdbCredentialStore(emptyDelegate, {
      persistence,
    });
    const restoredKeys: AdbPrivateKey[] = [];
    for await (const key of restoredStore.iterateKeys()) restoredKeys.push(key);

    expect(firstKeys).toHaveLength(1);
    expect([...restoredKeys[0]!.buffer]).toEqual([9, 8, 7]);
  });
});

describe("WebUsbAdbTransport multi-device lifecycle", () => {
  it("retains the first ADB connection when a second device connects", async () => {
    const firstUsb = fakeUsbDevice("SERIAL-A");
    const secondUsb = fakeUsbDevice("SERIAL-B");
    const devices = [firstUsb, secondUsb];
    const adbs = new Map([
      ["SERIAL-A", fakeAdb("SERIAL-A", "Galaxy A")],
      ["SERIAL-B", fakeAdb("SERIAL-B", "Galaxy B")],
    ]);
    const authenticate = vi.fn(async ({ serial }: { serial: string }) => {
      return { serial } as unknown as AdbDaemonTransport;
    }) as unknown as typeof AdbDaemonTransport.authenticate;
    const transport = new WebUsbAdbTransport(new Diagnostics(), {
      manager: {
        async getDevices() {
          return devices;
        },
        async requestDevice() {
          return undefined;
        },
      },
      credentialStore: EMPTY_CREDENTIAL_STORE,
      authenticate,
      createAdb: (adbTransport) => adbs.get(adbTransport.serial)!,
    });

    await Promise.all([
      transport.connectAuthorized("SERIAL-A"),
      transport.connectAuthorized("SERIAL-B"),
    ]);

    expect(transport.snapshot.connected.map((item) => item.serial)).toEqual([
      "SERIAL-A",
      "SERIAL-B",
    ]);
    expect(transport.get("SERIAL-A")).toBeDefined();
    expect(transport.get("SERIAL-B")).toBeDefined();
    expect(adbs.get("SERIAL-A")?.close).not.toHaveBeenCalled();
    for (const [options] of vi.mocked(authenticate).mock.calls) {
      expect(options).not.toHaveProperty("readTimeLimit");
    }

    await transport.disconnect("SERIAL-B");
    expect(transport.get("SERIAL-A")).toBeDefined();
    expect(transport.get("SERIAL-B")).toBeUndefined();
    expect(adbs.get("SERIAL-A")?.close).not.toHaveBeenCalled();
  });

  it("keeps status responsive while one device is authenticating", async () => {
    const firstUsb = fakeUsbDevice("SERIAL-A");
    const secondUsb = fakeUsbDevice("SERIAL-B");
    const gates = new Map([
      ["SERIAL-A", deferred<AdbDaemonTransport>()],
      ["SERIAL-B", deferred<AdbDaemonTransport>()],
    ]);
    const adbs = new Map([
      ["SERIAL-A", fakeAdb("SERIAL-A", "Galaxy A")],
      ["SERIAL-B", fakeAdb("SERIAL-B", "Galaxy B")],
    ]);
    const authenticate = vi.fn(({ serial }: { serial: string }) => {
      return gates.get(serial)!.promise;
    }) as unknown as typeof AdbDaemonTransport.authenticate;
    const transport = new WebUsbAdbTransport(new Diagnostics(), {
      manager: {
        async getDevices() {
          return [firstUsb, secondUsb];
        },
        async requestDevice() {
          return undefined;
        },
      },
      credentialStore: EMPTY_CREDENTIAL_STORE,
      authenticate,
      createAdb: (adbTransport) => adbs.get(adbTransport.serial)!,
    });

    const firstConnection = transport.connectAuthorized("SERIAL-A");
    await vi.waitFor(() => {
      expect(transport.snapshot.pending[0]?.stage).toBe("authenticating");
    });
    expect(transport.snapshot.phase).toBe("connecting");

    const secondConnection = transport.connectAuthorized("SERIAL-B");
    await vi.waitFor(() => {
      expect(transport.snapshot.pending).toHaveLength(2);
    });
    gates
      .get("SERIAL-B")!
      .resolve({ serial: "SERIAL-B" } as unknown as AdbDaemonTransport);
    await secondConnection;

    expect(transport.get("SERIAL-B")).toBeDefined();
    expect(transport.snapshot.pending.map((item) => item.descriptor.serial)).toEqual([
      "SERIAL-A",
    ]);

    gates
      .get("SERIAL-A")!
      .resolve({ serial: "SERIAL-A" } as unknown as AdbDaemonTransport);
    await firstConnection;
    expect(transport.snapshot.connected).toHaveLength(2);
  });

  it("does not claim approval is required for an already-authorized device", async () => {
    const usb = fakeUsbDevice("SERIAL-A");
    const stages: string[] = [];
    const transport = new WebUsbAdbTransport(new Diagnostics(), {
      manager: {
        async getDevices() {
          return [usb];
        },
        async requestDevice() {
          return undefined;
        },
      },
      credentialStore: EMPTY_CREDENTIAL_STORE,
      authenticate: vi.fn(async ({ serial }: { serial: string }) => {
        return { serial } as unknown as AdbDaemonTransport;
      }) as unknown as typeof AdbDaemonTransport.authenticate,
      createAdb: () => fakeAdb("SERIAL-A", "Galaxy"),
    });
    transport.subscribe((snapshot) => {
      stages.push(...snapshot.pending.map((item) => item.stage));
    });

    await transport.connectAuthorized("SERIAL-A");

    expect(stages).toContain("authenticating");
    expect(stages).not.toContain("authorizing");
    expect(transport.snapshot.phase).toBe("connected");
    expect(transport.snapshot.pending).toHaveLength(0);
  });

  it("shows approval only after Android requests the public key", async () => {
    const usb = fakeUsbDevice("SERIAL-A");
    const key = await createValidPrivateKey();
    const approval = deferred<void>();
    const credentialStore: AdbCredentialStore = {
      async generateKey() {
        return key;
      },
      *iterateKeys() {
        yield key;
      },
    };
    const authenticate = vi.fn(
      async ({
        serial,
        authenticators,
      }: Parameters<typeof AdbDaemonTransport.authenticate>[0]) => {
        const publicKeyAuthenticator = authenticators?.[1];
        if (!publicKeyAuthenticator) {
          throw new Error("Missing public-key authenticator");
        }
        const iterator = publicKeyAuthenticator(
          credentialStore,
          async () => ({
            command: AdbCommand.Auth,
            arg0: AdbAuthType.Token,
            arg1: 0,
            payload: new Uint8Array(20),
          }),
        )[Symbol.asyncIterator]();
        await iterator.next();
        await approval.promise;
        return { serial } as unknown as AdbDaemonTransport;
      },
    ) as unknown as typeof AdbDaemonTransport.authenticate;
    const transport = new WebUsbAdbTransport(new Diagnostics(), {
      manager: {
        async getDevices() {
          return [usb];
        },
        async requestDevice() {
          return undefined;
        },
      },
      credentialStore,
      authenticate,
      createAdb: () => fakeAdb("SERIAL-A", "Galaxy"),
      authorizationTimeoutMs: 1_000,
    });

    const connection = transport.connectAuthorized("SERIAL-A");
    await vi.waitFor(() => {
      expect(transport.snapshot.pending[0]?.stage).toBe("authorizing");
    });
    approval.resolve();
    await connection;

    expect(transport.snapshot.phase).toBe("connected");
    expect(transport.snapshot.pending).toHaveLength(0);
  });

  it("reopens a stale trusted USB handshake instead of waiting for approval", async () => {
    const usb = fakeUsbDevice("SERIAL-A");
    let authenticationAttempt = 0;
    const authenticate = vi.fn(({ serial }: { serial: string }) => {
      authenticationAttempt += 1;
      if (authenticationAttempt === 1) {
        return new Promise<AdbDaemonTransport>(() => {});
      }
      return Promise.resolve({
        serial,
      } as unknown as AdbDaemonTransport);
    }) as unknown as typeof AdbDaemonTransport.authenticate;
    const stages: string[] = [];
    const transport = new WebUsbAdbTransport(new Diagnostics(), {
      manager: {
        async getDevices() {
          return [usb];
        },
        async requestDevice() {
          return undefined;
        },
      },
      credentialStore: EMPTY_CREDENTIAL_STORE,
      authenticate,
      createAdb: () => fakeAdb("SERIAL-A", "Galaxy"),
      handshakeTimeoutMs: 5,
      staleHandshakeRetries: 1,
    });
    transport.subscribe((snapshot) => {
      stages.push(...snapshot.pending.map((item) => item.stage));
    });

    await transport.connectAuthorized("SERIAL-A");

    expect(usb.connect).toHaveBeenCalledTimes(2);
    expect(authenticate).toHaveBeenCalledTimes(2);
    expect(stages).not.toContain("authorizing");
    expect(transport.snapshot.phase).toBe("connected");
    expect(transport.snapshot.pending).toHaveLength(0);
  });

  it("separates identical USB fallbacks and upgrades them to Android serials", async () => {
    const firstUsb = fakeUsbDevice(
      "04e8x6860",
      "SAMSUNG_android",
      null,
      "ANDROID-SERIAL-A",
    );
    const secondUsb = fakeUsbDevice(
      "04e8x6860",
      "SAMSUNG_android",
      null,
      "ANDROID-SERIAL-B",
    );
    const authenticate = vi.fn(
      async ({
        serial,
        connection,
      }: {
        serial: string;
        connection: { androidSerial: string };
      }) => {
        return {
          serial,
          androidSerial: connection.androidSerial,
        } as unknown as AdbDaemonTransport;
      },
    ) as unknown as typeof AdbDaemonTransport.authenticate;
    const transport = new WebUsbAdbTransport(new Diagnostics(), {
      manager: {
        async getDevices() {
          return [firstUsb, secondUsb];
        },
        async requestDevice() {
          return undefined;
        },
      },
      credentialStore: EMPTY_CREDENTIAL_STORE,
      authenticate,
      createAdb: (adbTransport) => {
        const androidSerial = (
          adbTransport as unknown as { androidSerial: string }
        ).androidSerial;
        return fakeAdb(androidSerial, "Galaxy");
      },
    });

    const authorized = await transport.listAuthorizedDevices();
    expect(new Set(authorized.map((device) => device.serial)).size).toBe(2);
    await Promise.all(
      authorized.map((device) =>
        transport.connectAuthorized(device.serial),
      ),
    );

    expect(
      transport.snapshot.connected.map((device) => device.serial).sort(),
    ).toEqual(["ANDROID-SERIAL-A", "ANDROID-SERIAL-B"]);
  });

  it("automatically reconnects a trusted USB serial without opening a chooser", async () => {
    let devices = [fakeUsbDevice("SERIAL-A")];
    let onListChange:
      | ((next: readonly AdbDaemonWebUsbDevice[]) => void)
      | undefined;
    const firstDisconnected = deferred<void>();
    const adbs = [
      {
        ...fakeAdb("SERIAL-A", "Galaxy"),
        disconnected: firstDisconnected.promise,
      } as unknown as Adb,
      fakeAdb("SERIAL-A", "Galaxy"),
    ];
    let adbIndex = 0;
    const requestDevice = vi.fn(async () => undefined);
    const authenticate = vi.fn(async ({ serial }: { serial: string }) => {
      return { serial } as unknown as AdbDaemonTransport;
    }) as unknown as typeof AdbDaemonTransport.authenticate;
    const transport = new WebUsbAdbTransport(new Diagnostics(), {
      manager: {
        async getDevices() {
          return devices;
        },
        requestDevice,
        async trackDevices() {
          return {
            onListChange(listener: typeof onListChange) {
              onListChange = listener;
              listener?.(devices);
              return { dispose() {} };
            },
            stop() {},
          } as unknown as import("@yume-chan/adb-daemon-webusb").AdbDaemonWebUsbDeviceObserver;
        },
      },
      credentialStore: EMPTY_CREDENTIAL_STORE,
      authenticate,
      createAdb: () => adbs[adbIndex++]!,
    });

    await transport.startTrackingDevices();
    await transport.connectAuthorized("SERIAL-A");
    devices = [];
    onListChange?.(devices);
    firstDisconnected.resolve();
    await vi.waitFor(() => {
      expect(transport.snapshot.pending[0]).toMatchObject({
        stage: "reconnecting",
        descriptor: { serial: "SERIAL-A" },
      });
    });

    devices = [fakeUsbDevice("SERIAL-A")];
    onListChange?.(devices);
    await vi.waitFor(() => {
      expect(transport.get("SERIAL-A")?.adb).toBe(adbs[1]);
    });

    expect(requestDevice).not.toHaveBeenCalled();
    expect(authenticate).toHaveBeenCalledTimes(2);
    expect(transport.snapshot.pending).toHaveLength(0);
  });

  it("retries up to 3 times on connection error and succeeds on second attempt", async () => {
    const usb = fakeUsbDevice("SERIAL-A");
    let connectAttempts = 0;
    usb.connect = vi.fn(async () => {
      connectAttempts += 1;
      if (connectAttempts === 1) {
        throw new Error("USB interface claimed by another process");
      }
      return { androidSerial: "SERIAL-A" };
    });
    const authenticate = vi.fn(async ({ serial }: { serial: string }) => {
      return { serial } as unknown as AdbDaemonTransport;
    }) as unknown as typeof AdbDaemonTransport.authenticate;
    const transport = new WebUsbAdbTransport(new Diagnostics(), {
      manager: {
        async getDevices() {
          return [usb];
        },
        async requestDevice() {
          return undefined;
        },
      },
      credentialStore: EMPTY_CREDENTIAL_STORE,
      authenticate,
      createAdb: () => fakeAdb("SERIAL-A", "Galaxy"),
    });

    const connected = await transport.connectAuthorized("SERIAL-A");

    expect(usb.connect).toHaveBeenCalledTimes(2);
    expect(authenticate).toHaveBeenCalledTimes(1);
    expect(connected.descriptor.serial).toBe("SERIAL-A");
    expect(transport.snapshot.phase).toBe("connected");
    expect(transport.snapshot.pending).toHaveLength(0);
  });

  it("retries up to 3 times on authentication failure and succeeds on third attempt", async () => {
    const usb = fakeUsbDevice("SERIAL-A");
    let authAttempts = 0;
    const authenticate = vi.fn(async ({ serial }: { serial: string }) => {
      authAttempts += 1;
      if (authAttempts < 3) {
        throw new Error("Temporary ADB authentication failure");
      }
      return { serial } as unknown as AdbDaemonTransport;
    }) as unknown as typeof AdbDaemonTransport.authenticate;
    const transport = new WebUsbAdbTransport(new Diagnostics(), {
      manager: {
        async getDevices() {
          return [usb];
        },
        async requestDevice() {
          return undefined;
        },
      },
      credentialStore: EMPTY_CREDENTIAL_STORE,
      authenticate,
      createAdb: () => fakeAdb("SERIAL-A", "Galaxy"),
    });

    const connected = await transport.connectAuthorized("SERIAL-A");

    expect(usb.connect).toHaveBeenCalledTimes(3);
    expect(authenticate).toHaveBeenCalledTimes(3);
    expect(connected.descriptor.serial).toBe("SERIAL-A");
    expect(transport.snapshot.phase).toBe("connected");
    expect(transport.snapshot.pending).toHaveLength(0);
  });

  it("stops and reports error after 3 failed connection attempts", async () => {
    const usb = fakeUsbDevice("SERIAL-A");
    usb.connect = vi.fn(async () => {
      throw new Error("Persistent USB device communication error");
    });
    const authenticate = vi.fn(async ({ serial }: { serial: string }) => {
      return { serial } as unknown as AdbDaemonTransport;
    }) as unknown as typeof AdbDaemonTransport.authenticate;
    const transport = new WebUsbAdbTransport(new Diagnostics(), {
      manager: {
        async getDevices() {
          return [usb];
        },
        async requestDevice() {
          return undefined;
        },
      },
      credentialStore: EMPTY_CREDENTIAL_STORE,
      authenticate,
      createAdb: () => fakeAdb("SERIAL-A", "Galaxy"),
    });

    await expect(transport.connectAuthorized("SERIAL-A")).rejects.toThrow(
      "Persistent USB device communication error",
    );

    expect(usb.connect).toHaveBeenCalledTimes(3);
    expect(authenticate).not.toHaveBeenCalled();
    expect(transport.snapshot.phase).toBe("error");
    expect(transport.snapshot.pending).toHaveLength(0);
  });

  it("does not retry when connection attempt is cancelled by user", async () => {
    const usb = fakeUsbDevice("SERIAL-A");
    const gate = deferred<{ androidSerial: string }>();
    usb.connect = vi.fn(() => gate.promise);
    const transport = new WebUsbAdbTransport(new Diagnostics(), {
      manager: {
        async getDevices() {
          return [usb];
        },
        async requestDevice() {
          return undefined;
        },
      },
      credentialStore: EMPTY_CREDENTIAL_STORE,
      authenticate: vi.fn(async ({ serial }: { serial: string }) => {
        return { serial } as unknown as AdbDaemonTransport;
      }) as unknown as typeof AdbDaemonTransport.authenticate,
      createAdb: () => fakeAdb("SERIAL-A", "Galaxy"),
    });

    const connectPromise = transport.connectAuthorized("SERIAL-A");
    await vi.waitFor(() => {
      expect(transport.snapshot.pending).toHaveLength(1);
    });
    transport.cancel("SERIAL-A");
    gate.resolve({ androidSerial: "SERIAL-A" });

    await expect(connectPromise).rejects.toThrow("Connection attempt cancelled");
    expect(usb.connect).toHaveBeenCalledTimes(1);
    expect(transport.snapshot.pending).toHaveLength(0);
  });
});
