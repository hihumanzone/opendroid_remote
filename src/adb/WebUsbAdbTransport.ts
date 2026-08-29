import {
  Adb,
  AdbDaemonTransport,
  type AdbCredentialStore,
  type AdbDaemonConnection,
} from "@yume-chan/adb";
import AdbWebCredentialStore from "@yume-chan/adb-credential-web";
import {
  AdbDaemonWebUsbDevice,
  AdbDaemonWebUsbDeviceManager,
} from "@yume-chan/adb-daemon-webusb";
import type { AdbDaemonWebUsbDeviceObserver } from "@yume-chan/adb-daemon-webusb";

import type {
  ConnectionPhase,
  DeviceDescriptor,
} from "../core/types";
import type { Diagnostics } from "../debug/Diagnostics";
import {
  authenticateAdbConnection,
  StaleAdbHandshakeError,
} from "./AdbAuthentication";
import { StableAdbCredentialStore } from "./StableAdbCredentialStore";
import {
  createDeviceDescriptor,
  mergeDeviceDescriptors,
} from "./deviceIdentity";

export interface ConnectedAdbDevice {
  adb: Adb;
  usbDevice: AdbDaemonWebUsbDevice;
  descriptor: DeviceDescriptor;
}

export type PendingConnectionStage =
  | "connecting"
  | "authenticating"
  | "authorizing"
  | "reconnecting";

export interface PendingAdbDevice {
  descriptor: DeviceDescriptor;
  stage: PendingConnectionStage;
  startedAt: number;
}

export interface AdbTransportSnapshot {
  phase: ConnectionPhase;
  devices: readonly DeviceDescriptor[];
  connected: readonly DeviceDescriptor[];
  pending: readonly PendingAdbDevice[];
  chooserOpen: boolean;
  error?: string;
  errorSerial?: string;
}

interface DeviceManagerLike {
  getDevices(): Promise<AdbDaemonWebUsbDevice[]>;
  requestDevice(): Promise<AdbDaemonWebUsbDevice | undefined>;
  trackDevices?(): Promise<AdbDaemonWebUsbDeviceObserver>;
}

export interface WebUsbAdbTransportOptions {
  manager?: DeviceManagerLike | null;
  credentialStore?: AdbCredentialStore;
  authenticate?: typeof AdbDaemonTransport.authenticate;
  createAdb?: (transport: AdbDaemonTransport) => Adb;
  handshakeTimeoutMs?: number;
  staleHandshakeRetries?: number;
  connectionRetries?: number;
  connectionRetryDelayMs?: number;
  authorizationTimeoutMs?: number;
  autoReconnect?: boolean;
}

type SnapshotListener = (snapshot: AdbTransportSnapshot) => void;

const AUTHORIZATION_TIMEOUT_MS = 120_000;
const HANDSHAKE_TIMEOUT_MS = 10_000;
const DEFAULT_CONNECTION_RETRIES = 2;
const DEFAULT_CONNECTION_RETRY_DELAY_MS = 500;
const RECONNECT_RETRY_DELAY_MS = 1_500;

interface ReconnectIntent {
  serial: string;
  descriptor: DeviceDescriptor;
  raw: AdbDaemonWebUsbDevice["raw"];
  usbSerial?: string;
  fingerprint: string;
  startedAt: number;
}

function descriptorOf(
  device: AdbDaemonWebUsbDevice,
  serial: string,
  model?: string,
): DeviceDescriptor {
  return createDeviceDescriptor({
    serial,
    name: device.name || "Android device",
    model,
    vendorId: device.raw.vendorId,
    productId: device.raw.productId,
  });
}

function humanizeError(error: unknown): string {
  if (error instanceof AdbDaemonWebUsbDevice.DeviceBusyError) {
    return "The USB interface is busy. Close native ADB, scrcpy, Android Studio device tools, or another browser tab, then retry.";
  }
  if (error instanceof DOMException) {
    if (error.name === "SecurityError") {
      return "WebUSB was blocked. Open this page over HTTPS (or localhost) and allow USB access.";
    }
    if (error.name === "NotFoundError") {
      if (
        error.message &&
        error.message.toLowerCase().includes("disconnected")
      ) {
        return "The USB device was disconnected.";
      }
      return "No USB device was selected.";
    }
    if (error.name === "NetworkError") {
      return "The USB connection was interrupted or claimed by another process.";
    }
  }
  return error instanceof Error ? error.message : String(error);
}

function isChooserCancellation(error: unknown): boolean {
  return error instanceof DOMException && error.name === "NotFoundError";
}

export class ConnectionCancelledError extends Error {
  constructor(message = "Connection attempt cancelled") {
    super(message);
    this.name = "ConnectionCancelledError";
    Object.setPrototypeOf(this, ConnectionCancelledError.prototype);
  }
}

function isConnectionCancellation(error: unknown): boolean {
  return (
    error instanceof ConnectionCancelledError ||
    (error instanceof Error && error.name === "ConnectionCancelledError")
  );
}

/**
 * Owns all WebUSB/ADB transports. Connections are keyed by ADB serial number,
 * so opening a second device never closes or supersedes the first one.
 */
export class WebUsbAdbTransport {
  readonly #manager: DeviceManagerLike | undefined;
  readonly #credentialStore: AdbCredentialStore;
  readonly #authenticate: typeof AdbDaemonTransport.authenticate;
  readonly #createAdb: (transport: AdbDaemonTransport) => Adb;
  readonly #handshakeTimeoutMs: number;
  readonly #connectionRetries: number;
  readonly #connectionRetryDelayMs: number;
  readonly #authorizationTimeoutMs: number;
  readonly #listeners = new Set<SnapshotListener>();
  readonly #diagnostics: Diagnostics;
  readonly #knownDevices = new Map<string, DeviceDescriptor>();
  readonly #connections = new Map<string, ConnectedAdbDevice>();
  readonly #pending = new Map<string, PendingAdbDevice>();
  readonly #pendingUsbDevices = new Map<string, AdbDaemonWebUsbDevice>();
  readonly #connectionPromises = new Map<
    string,
    Promise<ConnectedAdbDevice>
  >();
  readonly #attempts = new Map<string, number>();
  readonly #disconnecting = new Set<string>();
  readonly #deviceKeys = new WeakMap<AdbDaemonWebUsbDevice["raw"], string>();
  readonly #reconnectIntents = new Map<string, ReconnectIntent>();
  readonly #reconnectRetryTimers = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();
  readonly #pendingAttemptKeys = new Map<string, string>();

  #observer?: AdbDaemonWebUsbDeviceObserver;
  #observerListener?: { dispose(): void };
  #chooserOpen = false;
  #enumerating = false;
  #anonymousDeviceCounter = 0;
  #storagePersistenceRequested = false;
  #autoReconnect: boolean;
  #error?: string;
  #errorSerial?: string;
  #snapshot: AdbTransportSnapshot = {
    phase: "idle",
    devices: [],
    connected: [],
    pending: [],
    chooserOpen: false,
  };

  constructor(
    diagnostics: Diagnostics,
    options: WebUsbAdbTransportOptions = {},
  ) {
    this.#diagnostics = diagnostics;
    this.#manager =
      options.manager === null
        ? undefined
        : (options.manager ?? AdbDaemonWebUsbDeviceManager.BROWSER);
    this.#credentialStore =
      options.credentialStore ??
      new StableAdbCredentialStore(
        new AdbWebCredentialStore("OpenDroid Remote"),
      );
    this.#authenticate =
      options.authenticate ?? AdbDaemonTransport.authenticate;
    this.#createAdb = options.createAdb ?? ((transport) => new Adb(transport));
    this.#handshakeTimeoutMs =
      options.handshakeTimeoutMs ?? HANDSHAKE_TIMEOUT_MS;
    this.#connectionRetries =
      options.connectionRetries ??
      options.staleHandshakeRetries ??
      DEFAULT_CONNECTION_RETRIES;
    this.#connectionRetryDelayMs =
      options.connectionRetryDelayMs ??
      (typeof process !== "undefined" && process.env?.NODE_ENV === "test"
        ? 0
        : DEFAULT_CONNECTION_RETRY_DELAY_MS);
    this.#authorizationTimeoutMs =
      options.authorizationTimeoutMs ?? AUTHORIZATION_TIMEOUT_MS;
    this.#autoReconnect = options.autoReconnect ?? true;
  }

  get supported(): boolean {
    return Boolean(this.#manager);
  }

  get snapshot(): AdbTransportSnapshot {
    return this.#snapshot;
  }

  get connected(): readonly ConnectedAdbDevice[] {
    return [...this.#connections.values()];
  }

  get(serial: string): ConnectedAdbDevice | undefined {
    return this.#connections.get(serial);
  }

  subscribe(listener: SnapshotListener): () => void {
    this.#listeners.add(listener);
    listener(this.#snapshot);
    return () => this.#listeners.delete(listener);
  }

  configureReconnect(enabled: boolean): void {
    this.#autoReconnect = enabled;
    if (!enabled) {
      for (const serial of this.#reconnectIntents.keys()) {
        const retryTimer = this.#reconnectRetryTimers.get(serial);
        if (retryTimer !== undefined) {
          globalThis.clearTimeout(retryTimer);
          this.#reconnectRetryTimers.delete(serial);
        }
        if (this.#pending.get(serial)?.stage === "reconnecting") {
          this.#pending.delete(serial);
          this.#pendingAttemptKeys.delete(serial);
        }
      }
      this.#reconnectIntents.clear();
      this.#emit();
    }
  }

  async startTrackingDevices(): Promise<readonly DeviceDescriptor[]> {
    this.#requestPersistentStorage();
    if (!this.#manager?.trackDevices) {
      return this.listAuthorizedDevices();
    }
    if (this.#observer) return this.#snapshot.devices;

    try {
      const observer = await this.#manager.trackDevices();
      this.#observer = observer;
      this.#observerListener = observer.onListChange((devices) => {
        this.#replaceKnownDevices(devices);
        void this.#reconnectAvailableDevices(devices);
        this.#diagnostics.info(
          "webusb",
          "device-list-change",
          `WebUSB now exposes ${devices.length} authorized Android device(s).`,
          this.#snapshot.devices,
        );
      });
      return this.#snapshot.devices;
    } catch (error) {
      this.#fail("Could not start USB device tracking", error);
      return this.listAuthorizedDevices();
    }
  }

  stopTrackingDevices(): void {
    this.#observerListener?.dispose();
    this.#observerListener = undefined;
    this.#observer?.stop();
    this.#observer = undefined;
  }

  async listAuthorizedDevices(): Promise<readonly DeviceDescriptor[]> {
    if (!this.#manager) {
      this.#setError(undefined, "This browser does not expose WebUSB.");
      return [];
    }

    this.#enumerating = true;
    this.#emit();
    try {
      const devices = await this.#manager.getDevices();
      const descriptors = this.#replaceKnownDevices(devices);
      this.#diagnostics.info(
        "webusb",
        "authorized-devices",
        `Found ${descriptors.length} previously authorized Android USB device(s).`,
        descriptors,
      );
      this.#emit();
      return this.#snapshot.devices;
    } catch (error) {
      this.#fail("Could not enumerate authorized USB devices", error);
      return [];
    } finally {
      this.#enumerating = false;
      this.#emit();
    }
  }

  async requestAndConnect(): Promise<ConnectedAdbDevice | undefined> {
    if (!this.#manager) {
      throw new Error("WebUSB is unavailable in this browser");
    }
    if (this.#chooserOpen) return undefined;

    this.#requestPersistentStorage();
    this.#chooserOpen = true;
    this.#clearError();
    this.#emit();
    this.#diagnostics.info(
      "webusb",
      "chooser-open",
      "Opening the browser USB device chooser.",
    );
    let device: AdbDaemonWebUsbDevice | undefined;
    try {
      device = await this.#manager.requestDevice();
    } catch (error) {
      if (isChooserCancellation(error)) {
        this.#diagnostics.info(
          "webusb",
          "chooser-cancelled",
          "USB device selection was cancelled.",
        );
        return undefined;
      }
      this.#fail("USB device selection failed", error);
      throw error;
    } finally {
      this.#chooserOpen = false;
      this.#emit();
    }
    if (!device) return undefined;

    const descriptor = descriptorOf(device, this.#deviceKey(device));
    this.#knownDevices.set(descriptor.serial, descriptor);
    this.#emit();

    try {
      return await this.#connect(device, false);
    } catch (error) {
      if (isConnectionCancellation(error)) return undefined;
      throw error;
    }
  }

  async connectAuthorized(serial: string): Promise<ConnectedAdbDevice> {
    this.#requestPersistentStorage();
    const existing = this.#connections.get(serial);
    if (existing) return existing;
    const device = await this.#findAuthorizedDevice(serial);
    return this.#connect(device, false);
  }

  async reconnect(serial: string): Promise<ConnectedAdbDevice> {
    await this.disconnect(serial);
    const device = await this.#findAuthorizedDevice(serial);
    return this.#connect(device, true);
  }

  cancel(serial: string): void {
    this.#forgetReconnect(serial, false);
    const attemptKey = this.#pendingAttemptKeys.get(serial) ?? serial;
    this.#attempts.set(
      attemptKey,
      (this.#attempts.get(attemptKey) ?? 0) + 1,
    );
    this.#pending.delete(serial);
    this.#pendingAttemptKeys.delete(serial);
    const device = this.#pendingUsbDevices.get(serial);
    this.#pendingUsbDevices.delete(serial);
    if (device?.raw.opened) void device.raw.close().catch(() => {});
    this.#diagnostics.info(
      "adb",
      "connection-cancelled",
      `Cancelled the connection attempt for ${serial}.`,
    );
    this.#emit();
  }

  async disconnect(serial: string): Promise<void> {
    this.#forgetReconnect(serial);
    this.cancel(serial);
    const current = this.#connections.get(serial);
    if (!current) return;

    this.#disconnecting.add(serial);
    this.#connections.delete(serial);
    this.#emit();
    try {
      await current.adb.close();
    } catch (error) {
      this.#diagnostics.warn(
        "adb",
        "disconnect-cleanup",
        "ADB transport was already closed during cleanup.",
        error,
      );
    }
    try {
      if (current.usbDevice.raw.opened) {
        await current.usbDevice.raw.close();
      }
    } catch {
      // A physical disconnect can close the USB handle before this cleanup.
    } finally {
      this.#disconnecting.delete(serial);
      this.#diagnostics.info(
        "adb",
        "disconnected",
        `Disconnected ${current.descriptor.label}.`,
      );
      this.#emit();
    }
  }

  async disconnectAll(): Promise<void> {
    const serials = new Set([
      ...this.#connections.keys(),
      ...this.#pending.keys(),
      ...this.#reconnectIntents.keys(),
    ]);
    await Promise.all([...serials].map((serial) => this.disconnect(serial)));
  }

  async #findAuthorizedDevice(
    serial: string,
  ): Promise<AdbDaemonWebUsbDevice> {
    if (!this.#manager) {
      throw new Error("WebUSB is unavailable in this browser");
    }
    this.#clearError();
    this.#enumerating = true;
    this.#emit();
    try {
      const devices = await this.#manager.getDevices();
      for (const device of devices) {
        const descriptor = descriptorOf(device, this.#deviceKey(device));
        const previous = this.#knownDevices.get(descriptor.serial);
        this.#knownDevices.set(
          descriptor.serial,
          mergeDeviceDescriptors(
            previous ? [previous] : [],
            [descriptor],
          )[0]!,
        );
      }
      const device = devices.find(
        (candidate) => this.#deviceKey(candidate) === serial,
      );
      if (!device) {
        const error = new Error(
          "The authorized device is not currently connected. Reconnect the cable or select it in the USB chooser.",
        );
        this.#fail("Authorized device not found", error, serial);
        throw error;
      }
      return device;
    } finally {
      this.#enumerating = false;
      this.#emit();
    }
  }

  #replaceKnownDevices(
    devices: readonly AdbDaemonWebUsbDevice[],
  ): DeviceDescriptor[] {
    const descriptors = devices.map((device) =>
      descriptorOf(device, this.#deviceKey(device)),
    );
    const connectedDescriptors = [...this.#connections.values()].map(
      (connection) => connection.descriptor,
    );
    const pendingDescriptors = [...this.#pending.values()].map(
      (pending) => pending.descriptor,
    );
    this.#knownDevices.clear();
    for (const descriptor of mergeDeviceDescriptors(
      descriptors,
      connectedDescriptors,
      pendingDescriptors,
    )) {
      this.#knownDevices.set(descriptor.serial, descriptor);
    }
    this.#emit();
    return descriptors;
  }

  #connect(
    device: AdbDaemonWebUsbDevice,
    reconnecting: boolean,
    expectedSerial?: string,
  ): Promise<ConnectedAdbDevice> {
    const serial = this.#deviceKey(device);
    const existing = this.#connections.get(expectedSerial ?? serial);
    if (existing) return Promise.resolve(existing);
    const inFlight = this.#connectionPromises.get(serial);
    if (inFlight) return inFlight;

    const promise = this.#connectInternal(
      device,
      reconnecting,
      expectedSerial,
    ).finally(() => {
      if (this.#connectionPromises.get(serial) === promise) {
        this.#connectionPromises.delete(serial);
      }
      this.#emit();
    });
    this.#connectionPromises.set(serial, promise);
    return promise;
  }

  async #connectInternal(
    device: AdbDaemonWebUsbDevice,
    reconnecting: boolean,
    expectedSerial?: string,
  ): Promise<ConnectedAdbDevice> {
    const connectionKey = this.#deviceKey(device);
    const pendingSerial = expectedSerial ?? connectionKey;
    const attempt = (this.#attempts.get(connectionKey) ?? 0) + 1;
    this.#attempts.set(connectionKey, attempt);
    const descriptor = descriptorOf(device, pendingSerial);
    this.#knownDevices.set(pendingSerial, descriptor);
    this.#pendingUsbDevices.set(pendingSerial, device);
    this.#pendingAttemptKeys.set(pendingSerial, connectionKey);
    this.#pending.set(pendingSerial, {
      descriptor,
      stage: reconnecting ? "reconnecting" : "connecting",
      startedAt: Date.now(),
    });
    this.#clearError(pendingSerial);
    this.#emit();
    this.#diagnostics.info(
      "webusb",
      "usb-open",
      `Opening ${descriptor.label}.`,
      descriptor,
    );

    let currentDevice = device;
    try {
      let authenticatedTransport: AdbDaemonTransport | undefined;
      let activeHandshake = 0;
      for (
        let retry = 0;
        retry <= this.#connectionRetries;
        retry += 1
      ) {
        const handshake = retry + 1;
        activeHandshake = handshake;
        try {
          if (retry > 0 && this.#manager?.getDevices) {
            try {
              const available = await this.#manager.getDevices();
              const refreshed = available.find(
                (candidate) =>
                  this.#deviceKey(candidate) === connectionKey ||
                  candidate.raw === currentDevice.raw ||
                  (candidate.raw.serialNumber?.trim() &&
                    candidate.raw.serialNumber?.trim() ===
                      currentDevice.raw.serialNumber?.trim()),
              );
              if (refreshed) {
                currentDevice = refreshed;
                this.#pendingUsbDevices.set(pendingSerial, currentDevice);
              }
            } catch {
              // Retain current handle if scanning fails.
            }
          }
          const connection = await currentDevice.connect();
          this.#throwIfCancelled(connectionKey, attempt);
          authenticatedTransport = await this.#authenticateConnection(
            currentDevice,
            connection,
            pendingSerial,
            descriptor,
            () =>
              activeHandshake === handshake &&
              this.#attempts.get(connectionKey) === attempt,
          );
          break;
        } catch (error) {
          if (activeHandshake === handshake) activeHandshake = 0;
          try {
            if (currentDevice.raw.opened) await currentDevice.raw.close();
          } catch {
            // A stale or detached USB handle may already be closed.
          }
          if (
            isConnectionCancellation(error) ||
            this.#attempts.get(connectionKey) !== attempt ||
            retry >= this.#connectionRetries
          ) {
            if (
              !isConnectionCancellation(error) &&
              this.#attempts.get(connectionKey) !== attempt
            ) {
              throw new ConnectionCancelledError();
            }
            throw error;
          }
          this.#pending.set(pendingSerial, {
            descriptor,
            stage: reconnecting ? "reconnecting" : "connecting",
            startedAt:
              this.#pending.get(pendingSerial)?.startedAt ?? Date.now(),
          });
          this.#emit();
          const attemptNumber = retry + 1;
          const totalAttempts = this.#connectionRetries + 1;
          this.#diagnostics.warn(
            "adb",
            "connection-retry",
            error instanceof StaleAdbHandshakeError
              ? `The USB handshake for ${descriptor.label} stalled; reopening it with the same saved ADB identity (${attemptNumber}/${this.#connectionRetries}).`
              : `Connection attempt ${attemptNumber} of ${totalAttempts} for ${descriptor.label} failed (${humanizeError(error)}); retrying...`,
            error,
          );
          if (this.#connectionRetryDelayMs > 0) {
            await new Promise((resolve) =>
              setTimeout(resolve, this.#connectionRetryDelayMs),
            );
            this.#throwIfCancelled(connectionKey, attempt);
          }
        }
      }
      if (!authenticatedTransport) {
        throw new Error("Could not establish ADB connection after retry attempts.");
      }
      this.#throwIfCancelled(connectionKey, attempt);

      const adb = this.#createAdb(authenticatedTransport);
      const resolvedSerial = await this.#resolveStableSerial(
        currentDevice,
        adb,
        pendingSerial,
      );
      const connectedDescriptor = descriptorOf(
        currentDevice,
        resolvedSerial,
        adb.banner.model || adb.banner.product,
      );
      const connected: ConnectedAdbDevice = {
        adb,
        usbDevice: currentDevice,
        descriptor: connectedDescriptor,
      };
      const duplicate = this.#connections.get(resolvedSerial);
      if (duplicate && duplicate.adb !== adb) {
        await adb.close();
        throw new Error(
          `Android reported duplicate serial ${resolvedSerial}; refusing to replace an existing connection.`,
        );
      }
      this.#connections.set(resolvedSerial, connected);
      this.#knownDevices.delete(connectionKey);
      this.#knownDevices.delete(pendingSerial);
      this.#knownDevices.set(resolvedSerial, connectedDescriptor);
      this.#pending.delete(pendingSerial);
      this.#pendingUsbDevices.delete(pendingSerial);
      this.#pendingAttemptKeys.delete(pendingSerial);
      this.#forgetReconnect(pendingSerial, false);
      this.#forgetReconnect(resolvedSerial, false);
      this.#clearError(pendingSerial);
      this.#emit();
      this.#diagnostics.info(
        "adb",
        "authenticated",
        `ADB authenticated with ${connectedDescriptor.label}.`,
        {
          serial: resolvedSerial,
          product: adb.banner.product,
          model: adb.banner.model,
          device: adb.banner.device,
          features: adb.banner.features,
          maxPayloadSize: adb.maxPayloadSize,
        },
      );

      void adb.disconnected.then(
        () => this.#handlePhysicalDisconnect(resolvedSerial, adb),
        (error) =>
          this.#handlePhysicalDisconnect(resolvedSerial, adb, error),
      );
      return connected;
    } catch (error) {
      if (this.#attempts.get(connectionKey) === attempt) {
        this.#pending.delete(pendingSerial);
        this.#pendingUsbDevices.delete(pendingSerial);
        this.#pendingAttemptKeys.delete(pendingSerial);
      }
      try {
        if (currentDevice.raw.opened) await currentDevice.raw.close();
      } catch {
        // Ignore secondary cleanup failure.
      }
      if (isConnectionCancellation(error)) {
        this.#emit();
        throw error;
      }
      this.#fail("Could not establish ADB", error, pendingSerial);
      throw error;
    }
  }

  async #authenticateConnection(
    device: AdbDaemonWebUsbDevice,
    connection: AdbDaemonConnection,
    pendingSerial: string,
    descriptor: DeviceDescriptor,
    isCurrentHandshake: () => boolean,
  ): Promise<AdbDaemonTransport> {
    const startedAt =
      this.#pending.get(pendingSerial)?.startedAt ?? Date.now();
    this.#pending.set(pendingSerial, {
      descriptor,
      stage: "authenticating",
      startedAt,
    });
    this.#emit();
    this.#diagnostics.info(
      "adb",
      "authentication-start",
      `Checking ${descriptor.label} with the saved browser ADB identity.`,
    );

    return authenticateAdbConnection({
      serial: pendingSerial,
      connection,
      credentialStore: this.#credentialStore,
      authenticate: this.#authenticate,
      handshakeTimeoutMs: this.#handshakeTimeoutMs,
      authorizationTimeoutMs: this.#authorizationTimeoutMs,
      isCurrent: isCurrentHandshake,
      closeConnection: () => device.raw.close(),
      onApprovalRequired: () => {
        this.#pending.set(pendingSerial, {
          descriptor,
          stage: "authorizing",
          startedAt,
        });
        this.#emit();
        this.#diagnostics.info(
          "adb",
          "authorization-required",
          `Android requested approval for the saved browser ADB identity on ${descriptor.label}.`,
        );
      },
    });
  }

  #throwIfCancelled(serial: string, attempt: number): void {
    if (this.#attempts.get(serial) !== attempt) {
      throw new ConnectionCancelledError();
    }
  }

  #deviceKey(device: AdbDaemonWebUsbDevice): string {
    const usbSerial = device.raw.serialNumber?.trim();
    if (usbSerial) {
      this.#deviceKeys.set(device.raw, usbSerial);
      return usbSerial;
    }
    const existing = this.#deviceKeys.get(device.raw);
    if (existing) return existing;
    const provisional = `${device.serial}#usb-${++this.#anonymousDeviceCounter}`;
    this.#deviceKeys.set(device.raw, provisional);
    return provisional;
  }

  #deviceFingerprint(device: AdbDaemonWebUsbDevice): string {
    return [
      device.raw.vendorId,
      device.raw.productId,
      device.serial,
      device.name,
    ].join(":");
  }

  #forgetReconnect(serial: string, emit = true): void {
    this.#reconnectIntents.delete(serial);
    const retryTimer = this.#reconnectRetryTimers.get(serial);
    if (retryTimer !== undefined) {
      globalThis.clearTimeout(retryTimer);
      this.#reconnectRetryTimers.delete(serial);
    }
    if (this.#pending.get(serial)?.stage === "reconnecting") {
      this.#pending.delete(serial);
      this.#pendingUsbDevices.delete(serial);
      this.#pendingAttemptKeys.delete(serial);
    }
    if (emit) this.#emit();
  }

  async #scanForReconnect(): Promise<void> {
    if (!this.#manager || this.#reconnectIntents.size === 0) return;
    try {
      const devices = await this.#manager.getDevices();
      this.#replaceKnownDevices(devices);
      await this.#reconnectAvailableDevices(devices);
    } catch (error) {
      this.#diagnostics.debug(
        "webusb",
        "reconnect-scan-failed",
        "Could not scan authorized USB devices during automatic reconnect.",
        error,
      );
    }
  }

  async #reconnectAvailableDevices(
    devices: readonly AdbDaemonWebUsbDevice[],
  ): Promise<void> {
    if (!this.#autoReconnect || this.#reconnectIntents.size === 0) return;

    const claimed = new Set<AdbDaemonWebUsbDevice>();
    for (const intent of this.#reconnectIntents.values()) {
      if (
        this.#connections.has(intent.serial) ||
        [...this.#connectionPromises.keys()].some(
          (key) =>
            key === intent.serial ||
            this.#pendingAttemptKeys.get(intent.serial) === key,
        )
      ) {
        continue;
      }

      let device = devices.find(
        (candidate) =>
          !claimed.has(candidate) &&
          (candidate.raw === intent.raw ||
            (intent.usbSerial !== undefined &&
              candidate.raw.serialNumber?.trim() === intent.usbSerial)),
      );

      if (!device && !intent.usbSerial) {
        const matchingDevices = devices.filter(
          (candidate) =>
            !claimed.has(candidate) &&
            !candidate.raw.serialNumber?.trim() &&
            this.#deviceFingerprint(candidate) === intent.fingerprint,
        );
        const matchingIntents = [...this.#reconnectIntents.values()].filter(
          (candidate) =>
            !candidate.usbSerial &&
            candidate.fingerprint === intent.fingerprint,
        );
        // Serial-less identical devices cannot be safely paired. Only resume
        // when both sides of the match are unambiguous.
        if (matchingDevices.length === 1 && matchingIntents.length === 1) {
          [device] = matchingDevices;
        }
      }
      if (!device) continue;
      claimed.add(device);
      this.#diagnostics.info(
        "adb",
        "auto-reconnect-start",
        `Reconnecting ${intent.descriptor.label} with the saved ADB identity.`,
      );
      void this.#connect(device, true, intent.serial).catch((error) => {
        if (!this.#reconnectIntents.has(intent.serial)) return;
        this.#pending.set(intent.serial, {
          descriptor: intent.descriptor,
          stage: "reconnecting",
          startedAt: intent.startedAt,
        });
        this.#clearError(intent.serial);
        this.#emit();
        this.#diagnostics.warn(
          "adb",
          "auto-reconnect-paused",
          error instanceof StaleAdbHandshakeError
            ? `Automatic reconnect for ${intent.descriptor.label} encountered a stale USB handshake and will retry shortly.`
            : `Automatic reconnect for ${intent.descriptor.label} will retry when USB changes again.`,
          error,
        );
        if (error instanceof StaleAdbHandshakeError) {
          this.#scheduleReconnectScan(intent.serial);
        }
      });
    }
  }

  #scheduleReconnectScan(serial: string): void {
    if (this.#reconnectRetryTimers.has(serial)) return;
    const timer = globalThis.setTimeout(() => {
      this.#reconnectRetryTimers.delete(serial);
      if (!this.#reconnectIntents.has(serial)) return;
      void this.#scanForReconnect();
    }, RECONNECT_RETRY_DELAY_MS);
    this.#reconnectRetryTimers.set(serial, timer);
  }

  #requestPersistentStorage(): void {
    if (
      this.#storagePersistenceRequested ||
      typeof navigator === "undefined" ||
      !navigator.storage?.persist
    ) {
      return;
    }
    this.#storagePersistenceRequested = true;
    void navigator.storage
      .persist()
      .then((persistent) => {
        this.#diagnostics.info(
          "browser",
          "credential-storage-persistence",
          persistent
            ? "Browser granted persistent storage for the saved ADB credential."
            : "Browser retained its default storage policy for the saved ADB credential.",
        );
      })
      .catch((error) => {
        this.#diagnostics.debug(
          "browser",
          "credential-storage-persistence-unavailable",
          "Could not request persistent browser storage; IndexedDB credential reuse remains enabled.",
          error,
        );
      });
  }

  async #resolveStableSerial(
    device: AdbDaemonWebUsbDevice,
    adb: Adb,
    provisional: string,
  ): Promise<string> {
    const usbSerial = device.raw.serialNumber?.trim();
    if (usbSerial) return usbSerial;

    for (const property of ["ro.serialno", "ro.boot.serialno"]) {
      try {
        const value = (await adb.getProp(property)).trim();
        if (value && value.toLowerCase() !== "unknown") {
          this.#deviceKeys.set(device.raw, value);
          this.#diagnostics.info(
            "adb",
            "stable-device-id",
            `Resolved stable Android device ID ${value}.`,
            { property },
          );
          return value;
        }
      } catch (error) {
        this.#diagnostics.debug(
          "adb",
          "stable-device-id-unavailable",
          `Could not read ${property}; retaining the browser-scoped USB identity.`,
          error,
        );
      }
    }
    return provisional;
  }

  #handlePhysicalDisconnect(serial: string, adb: Adb, error?: unknown): void {
    if (this.#connections.get(serial)?.adb !== adb) return;
    const current = this.#connections.get(serial);
    const descriptor = current?.descriptor;
    this.#connections.delete(serial);
    this.#diagnostics.warn(
      "adb",
      "transport-disconnected",
      `${descriptor?.label ?? serial} disconnected from USB.`,
      error,
    );
    if (this.#autoReconnect && current && descriptor) {
      const intent: ReconnectIntent = {
        serial,
        descriptor,
        raw: current.usbDevice.raw,
        usbSerial: current.usbDevice.raw.serialNumber?.trim() || undefined,
        fingerprint: this.#deviceFingerprint(current.usbDevice),
        startedAt: Date.now(),
      };
      this.#reconnectIntents.set(serial, intent);
      this.#pending.set(serial, {
        descriptor,
        stage: "reconnecting",
        startedAt: intent.startedAt,
      });
      this.#clearError(serial);
      this.#emit();
      void this.#scanForReconnect();
      return;
    }
    this.#setError(serial, "Device disconnected");
  }

  #clearError(serial?: string): void {
    if (serial && this.#errorSerial && this.#errorSerial !== serial) return;
    this.#error = undefined;
    this.#errorSerial = undefined;
  }

  #setError(serial: string | undefined, message: string): void {
    this.#error = message;
    this.#errorSerial = serial;
    this.#emit();
  }

  #fail(context: string, error: unknown, serial?: string): void {
    const message = humanizeError(error);
    this.#diagnostics.error(
      "adb",
      "connection-error",
      `${context}: ${message}`,
      error,
    );
    this.#setError(serial, message);
  }

  #phase(): ConnectionPhase {
    if (this.#chooserOpen || this.#enumerating) return "discovering";
    if ([...this.#pending.values()].some((item) => item.stage === "authorizing")) {
      return "authorizing";
    }
    if ([...this.#pending.values()].some((item) => item.stage === "reconnecting")) {
      return "reconnecting";
    }
    if (this.#pending.size > 0) return "connecting";
    if (this.#disconnecting.size > 0) return "disconnecting";
    if (this.#connections.size > 0) return "connected";
    if (this.#error) return "error";
    return "idle";
  }

  #emit(): void {
    const connected = [...this.#connections.values()].map(
      (connection) => connection.descriptor,
    );
    const devices = mergeDeviceDescriptors(
      [...this.#knownDevices.values()],
      connected,
    );
    const snapshot: AdbTransportSnapshot = {
      phase: this.#phase(),
      devices,
      connected: mergeDeviceDescriptors(connected),
      pending: [...this.#pending.values()].sort(
        (left, right) => left.startedAt - right.startedAt,
      ),
      chooserOpen: this.#chooserOpen,
      error: this.#error,
      errorSerial: this.#errorSerial,
    };
    this.#snapshot = snapshot;
    for (const listener of this.#listeners) listener(snapshot);
  }
}
