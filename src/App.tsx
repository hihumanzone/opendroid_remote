"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  type AdbTransportSnapshot,
  WebUsbAdbTransport,
} from "./adb/WebUsbAdbTransport";
import {
  type BrowserCapabilities,
  capabilityChecks,
  detectBrowserCapabilities,
  missingRequiredCapabilities,
} from "./capabilities/browserCapabilities";
import {
  cloneStreamQuality,
  type NormalizedPoint,
  type StreamQuality,
} from "./core/types";
import { SerialTaskQueue } from "./core/SerialTaskQueue";
import { Diagnostics, type DiagnosticEntry } from "./debug/Diagnostics";
import {
  hasActiveMouseLook,
  mappedKeyboardCodes,
  mappedMouseButtons as collectMappedMouseButtons,
  routeKeyboardInput,
  type ControlMode,
} from "./input/controlMode";
import { DirectKeyRegistry } from "./input/DirectKeyRegistry";
import { MappingEngine } from "./input/MappingEngine";
import {
  androidMetaState,
  domCodeToAndroid,
  isEditableTarget,
} from "./input/keyboardMapping";
import { ProfileRepository } from "./profiles/ProfileRepository";
import { importProfileFiles } from "./profiles/ProfileImporter";
import {
  createId,
  createMapping,
  createProfile,
  serializeProfile,
  type GameMapping,
  type GameProfile,
  type MouseLookMapping,
} from "./profiles/schema";
import {
  AppSettingsRepository,
  createDefaultAppSettings,
  type AppSettings,
  type ConnectionPreferences,
  type ImportPreferences,
} from "./settings/AppSettings";
import {
  ScrcpySession,
  type ScrcpySessionSnapshot,
} from "./scrcpy/ScrcpySession";
import { AndroidControlDock } from "./ui/AndroidControlDock";
import { ConnectionChrome } from "./ui/ConnectionChrome";
import { DiagnosticsPanel } from "./ui/DiagnosticsPanel";
import { MappingPanel } from "./ui/MappingPanel";
import { ProfilePanel } from "./ui/ProfilePanel";
import { StageStatusBar } from "./ui/StageStatusBar";
import { StreamPanel } from "./ui/StreamPanel";
import { VideoStage } from "./ui/VideoStage";
import {
  WorkspaceTabs,
  type WorkspacePanelId,
} from "./ui/WorkspaceTabs";

const INITIAL_TRANSPORT: AdbTransportSnapshot = {
  phase: "idle",
  devices: [],
  connected: [],
  pending: [],
  chooserOpen: false,
};

const INITIAL_SESSION: ScrcpySessionSnapshot = {
  phase: "idle",
  message: "Connect an Android device to begin.",
  audio: { status: "off" },
  stats: {
    framesRendered: 0,
    framesSkipped: 0,
    width: 0,
    height: 0,
  },
};

const INITIAL_BROWSER_CAPABILITIES: BrowserCapabilities = {
  secureContext: false,
  webUsb: false,
  webCodecs: false,
  webAudio: false,
  webGl: false,
  pointerEvents: false,
  pointerLock: false,
  fullscreen: false,
  clipboardRead: false,
  clipboardWrite: false,
  indexedDb: false,
  cryptoSubtle: false,
};

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function downloadText(filename: string, content: string): void {
  const url = URL.createObjectURL(
    new Blob([content], { type: "application/json;charset=utf-8" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function safeFilename(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "opendroid-profile"
  );
}

export default function App() {
  const [diagnostics] = useState(() => new Diagnostics());
  const [transport] = useState(() => new WebUsbAdbTransport(diagnostics));
  const [session] = useState(() => new ScrcpySession(diagnostics));
  const [repository] = useState(() => new ProfileRepository(diagnostics));
  const [settingsRepository] = useState(
    () => new AppSettingsRepository(diagnostics),
  );

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const fullscreenRef = useRef<HTMLDivElement | null>(null);
  const qualityRef = useRef<StreamQuality>(cloneStreamQuality());
  const qualityBySerialRef = useRef(new Map<string, StreamQuality>());
  const appSettingsRef = useRef<AppSettings>(createDefaultAppSettings());
  const settingsSaveTimerRef = useRef<number | undefined>(undefined);
  const noticeTimerRef = useRef<number | undefined>(undefined);
  const activeSerialRef = useRef("");
  const resumeSerialRef = useRef("");
  const sessionQueueRef = useRef(new SerialTaskQueue());
  const engineRef = useRef<MappingEngine | null>(null);
  const directKeysRef = useRef(new DirectKeyRegistry());
  const profileRef = useRef<GameProfile | undefined>(undefined);
  const capturedMappingKeysRef = useRef(new Set<string>());
  const pointerLockRequestRef = useRef(false);

  const [browser, setBrowser] = useState(INITIAL_BROWSER_CAPABILITIES);
  const [browserReady, setBrowserReady] = useState(false);
  const [settingsReady, setSettingsReady] = useState(false);
  const [transportState, setTransportState] =
    useState<AdbTransportSnapshot>(INITIAL_TRANSPORT);
  const [sessionState, setSessionState] =
    useState<ScrcpySessionSnapshot>(INITIAL_SESSION);
  const [entries, setEntries] = useState<readonly DiagnosticEntry[]>([]);
  const [quality, setQualityState] = useState<StreamQuality>(() =>
    cloneStreamQuality(),
  );
  const [importPreferences, setImportPreferences] =
    useState<ImportPreferences>(
      () => createDefaultAppSettings().imports,
    );
  const [connectionPreferences, setConnectionPreferences] =
    useState<ConnectionPreferences>(
      () => createDefaultAppSettings().connection,
    );
  const [profiles, setProfiles] = useState<GameProfile[]>([]);
  const [profile, setProfile] = useState<GameProfile>();
  const [selectedMappingId, setSelectedMappingId] = useState<string>();
  const [selectedDevice, setSelectedDevice] = useState("");
  const [activeSerial, setActiveSerial] = useState("");
  const [panel, setPanel] = useState<WorkspacePanelId>("mappings");
  const [controlMode, setControlMode] = useState<ControlMode>("play");
  const [pointerLocked, setPointerLocked] = useState(false);
  const [cameraLockActive, setCameraLockActive] = useState(false);
  const [overlaysVisible, setOverlaysVisible] = useState(true);
  const [busy, setBusy] = useState(false);
  const [remoteClipboard, setRemoteClipboard] = useState("");
  const [notice, setNotice] = useState<string>();

  const profileReady = Boolean(profile);
  const checks = useMemo(() => capabilityChecks(browser), [browser]);
  const missing = useMemo(
    () => missingRequiredCapabilities(browser),
    [browser],
  );
  const streaming = sessionState.phase === "streaming";
  const streamOrientation =
    sessionState.stats.height > sessionState.stats.width
      ? "portrait"
      : "landscape";
  const mappedCodes = useMemo(
    () => mappedKeyboardCodes(profile, streamOrientation),
    [profile, streamOrientation],
  );
  const mouseButtons = useMemo(
    () => collectMappedMouseButtons(profile, streamOrientation),
    [profile, streamOrientation],
  );
  const hasMouseLook = hasActiveMouseLook(profile, streamOrientation);
  const activeMouseLookMapping = useMemo(
    () =>
      profile?.mappings.find(
        (mapping): mapping is MouseLookMapping =>
          mapping.type === "mouse-look" &&
          mapping.enabled &&
          (mapping.orientation === "any" || mapping.orientation === streamOrientation),
      ),
    [profile, streamOrientation],
  );
  const cameraLockEnableKey =
    activeMouseLookMapping?.enableTrigger?.code ??
    (hasMouseLook ? "KeyY" : undefined);
  const cameraLockDisableKey =
    activeMouseLookMapping?.disableTrigger?.code ??
    (hasMouseLook ? "Escape" : undefined);
  const effectiveMouseMode =
    session.control?.mouseMode ??
    (quality.mouse.mode === "uhid" &&
    sessionState.capabilities?.uhidMouse.supported === false
      ? "disabled"
      : quality.mouse.mode);

  const persistSettings = useCallback(
    (next: AppSettings) => {
      appSettingsRef.current = next;
      if (settingsSaveTimerRef.current !== undefined) {
        window.clearTimeout(settingsSaveTimerRef.current);
      }
      settingsSaveTimerRef.current = window.setTimeout(() => {
        settingsSaveTimerRef.current = undefined;
        settingsRepository.save(appSettingsRef.current);
      }, 220);
    },
    [settingsRepository],
  );

  const setQuality = useCallback(
    (next: StreamQuality) => {
      qualityRef.current = next;
      session.setAudioVolume(next.audio.volume);
      const serial = activeSerialRef.current;
      const currentSettings = appSettingsRef.current;
      if (serial) {
        qualityBySerialRef.current.set(serial, cloneStreamQuality(next));
        persistSettings({
          ...currentSettings,
          devices: [
            ...currentSettings.devices.filter(
              (item) => item.serial !== serial,
            ),
            { serial, quality: cloneStreamQuality(next) },
          ],
        });
      } else {
        persistSettings({
          ...currentSettings,
          defaultQuality: cloneStreamQuality(next),
        });
      }
      setQualityState(next);
    },
    [persistSettings, session],
  );

  const resetQuality = useCallback(() => {
    const serial = activeSerialRef.current;
    const currentSettings = appSettingsRef.current;
    const next = cloneStreamQuality(currentSettings.defaultQuality);
    if (serial) {
      qualityBySerialRef.current.delete(serial);
      persistSettings({
        ...currentSettings,
        devices: currentSettings.devices.filter(
          (item) => item.serial !== serial,
        ),
      });
    }
    qualityRef.current = next;
    session.setAudioVolume(next.audio.volume);
    setQualityState(next);
  }, [persistSettings, session]);

  const changeImportPreferences = useCallback(
    (next: ImportPreferences) => {
      setImportPreferences(next);
      persistSettings({ ...appSettingsRef.current, imports: next });
    },
    [persistSettings],
  );

  const changeConnectionPreferences = useCallback(
    (next: ConnectionPreferences) => {
      setConnectionPreferences(next);
      transport.configureReconnect(next.autoReconnect);
      if (!next.autoReconnect || !next.resumeStream) {
        resumeSerialRef.current = "";
      }
      persistSettings({ ...appSettingsRef.current, connection: next });
    },
    [persistSettings, transport],
  );

  const showNotice = useCallback((message: string) => {
    if (noticeTimerRef.current !== undefined) {
      window.clearTimeout(noticeTimerRef.current);
    }
    setNotice(message);
    noticeTimerRef.current = window.setTimeout(
      () => {
        noticeTimerRef.current = undefined;
        setNotice((current) =>
          current === message ? undefined : current,
        );
      },
      3_800,
    );
  }, []);

  const releaseAllInput = useCallback(
    async (exitPointerLock = false): Promise<void> => {
      capturedMappingKeysRef.current.clear();
      const control = session.control;
      try {
        await engineRef.current?.releaseAll();
      } catch {
        // Continue draining direct state even if the control socket has closed.
      }
      for (const key of directKeysRef.current.releaseAll()) {
        if (!control) continue;
        try {
          await control.key({
            code: key.androidCode,
            action: "up",
            metaState: key.metaState,
          });
        } catch {
          // Session teardown can close the control socket between input writes.
        }
      }
      try {
        await control?.releaseMouseButtons();
      } catch {
        // Session teardown can close the control socket between input writes.
      }
      if (exitPointerLock && document.pointerLockElement) {
        try {
          await document.exitPointerLock();
        } catch {
          // Pointer Lock may already have been released by the browser.
        }
      }
    },
    [session],
  );

  const changeControlMode = useCallback(
    (next: ControlMode) => {
      setControlMode(next);
      if (next === "edit") {
        setCameraLockActive(false);
        void releaseAllInput(true);
      } else {
        setSelectedMappingId(undefined);
        surfaceRef.current?.focus({ preventScroll: true });
      }
    },
    [releaseAllInput],
  );

  const requestPointerLock = useCallback(async () => {
    if (!browser.pointerLock || !surfaceRef.current) {
      showNotice("Pointer Lock is unavailable in this browser.");
      return;
    }
    if (
      document.pointerLockElement === surfaceRef.current ||
      pointerLockRequestRef.current
    ) {
      return;
    }
    pointerLockRequestRef.current = true;
    const surface = surfaceRef.current;
    try {
      if (qualityRef.current.mouse.rawInput) {
        try {
          const rawLock = surface.requestPointerLock({
            unadjustedMovement: true,
          } as PointerLockOptions);
          if (rawLock && typeof (rawLock as Promise<void>).then === "function") {
            await rawLock;
          }
          diagnostics.info(
            "control",
            "raw-pointer-lock",
            "Pointer Lock captured unadjusted mouse movement.",
          );
          return;
        } catch (error) {
          diagnostics.debug(
            "control",
            "raw-pointer-lock-unavailable",
            "Raw pointer movement is unavailable; retrying standard Pointer Lock.",
            error,
          );
        }
      }
      const standardLock = surface.requestPointerLock();
      if (
        standardLock &&
        typeof (standardLock as Promise<void>).then === "function"
      ) {
        await standardLock;
      }
    } catch (error) {
      setCameraLockActive(false);
      diagnostics.warn(
        "control",
        "pointer-lock-failed",
        "The browser did not allow mouse capture.",
        error,
      );
      showNotice("Mouse capture was blocked by the browser.");
    } finally {
      pointerLockRequestRef.current = false;
    }
  }, [browser.pointerLock, diagnostics, showNotice]);

  const enableCameraLock = useCallback(async () => {
    if (!hasMouseLook) return;
    setCameraLockActive(true);
    await requestPointerLock();
    void engineRef.current?.setPointerLockActive(true);
  }, [hasMouseLook, requestPointerLock]);

  const disableCameraLock = useCallback(async () => {
    setCameraLockActive(false);
    if (document.pointerLockElement) {
      try {
        await document.exitPointerLock();
      } catch {}
    }
    void engineRef.current?.setPointerLockActive(false);
    void session.control?.releaseMouseButtons();
  }, [session]);

  const toggleCameraLock = useCallback(async () => {
    if (cameraLockActive) {
      await disableCameraLock();
    } else {
      await enableCameraLock();
    }
  }, [cameraLockActive, disableCameraLock, enableCameraLock]);

  const activateDeviceNow = useCallback(
    async (serial: string, announce = true): Promise<void> => {
      const device = transport.get(serial);
      const canvas = canvasRef.current;
      if (!device) {
        throw new Error(`ADB device ${serial} is not connected`);
      }
      if (!canvas) return;

      setBusy(true);
      setControlMode("play");
      try {
        await releaseAllInput(true);
        await session.stop();

        const nextQuality =
          qualityBySerialRef.current.get(serial) ??
          cloneStreamQuality(appSettingsRef.current.defaultQuality);
        qualityBySerialRef.current.set(serial, nextQuality);
        qualityRef.current = nextQuality;
        setQualityState(nextQuality);
        activeSerialRef.current = serial;
        resumeSerialRef.current = "";
        setActiveSerial(serial);
        setSelectedDevice(serial);
        setRemoteClipboard("");

        await session.prepare(device.adb);
        await session.start(device.adb, canvas, nextQuality);
        surfaceRef.current?.focus({ preventScroll: true });
        if (announce) showNotice(`Controlling ${device.descriptor.label}.`);
      } finally {
        setBusy(false);
      }
    },
    [releaseAllInput, session, showNotice, transport],
  );

  const activateDevice = useCallback(
    (serial: string, announce = true): Promise<void> =>
      sessionQueueRef.current.run(() => activateDeviceNow(serial, announce)),
    [activateDeviceNow],
  );

  const updateProfile = useCallback((next: GameProfile) => {
    setProfile(next);
    setProfiles((items) =>
      items.some((item) => item.id === next.id)
        ? items.map((item) => (item.id === next.id ? next : item))
        : [next, ...items],
    );
  }, []);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      const stored = settingsRepository.load();
      appSettingsRef.current = stored;
      qualityBySerialRef.current = new Map(
        stored.devices.map((item) => [
          item.serial,
          cloneStreamQuality(item.quality),
        ]),
      );
      const initialQuality = cloneStreamQuality(stored.defaultQuality);
      qualityRef.current = initialQuality;
      session.setAudioVolume(initialQuality.audio.volume);
      setQualityState(initialQuality);
      setImportPreferences(stored.imports);
      setConnectionPreferences(stored.connection);
      transport.configureReconnect(stored.connection.autoReconnect);
      setSettingsReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [session, settingsRepository, transport]);

  useEffect(() => {
    queueMicrotask(() => {
      const detected = detectBrowserCapabilities();
      setBrowser(detected);
      if (!detected.webAudio) {
        const next = {
          ...qualityRef.current,
          audio: { ...qualityRef.current.audio, enabled: false },
        };
        qualityRef.current = next;
        setQualityState(next);
      }
      setBrowserReady(true);
    });
  }, []);

  useEffect(
    () =>
      transport.subscribe((next) => {
        setTransportState(next);
        const resumableSerial = resumeSerialRef.current;
        if (
          resumableSerial &&
          next.connected.some(
            (device) => device.serial === resumableSerial,
          )
        ) {
          resumeSerialRef.current = "";
          void activateDevice(resumableSerial, false)
            .then(() => showNotice(`Reconnected ${resumableSerial}.`))
            .catch((error) => {
              diagnostics.error(
                "scrcpy",
                "reconnect-activation-failed",
                `ADB reconnected, but mirroring could not resume for ${resumableSerial}.`,
                error,
              );
              showNotice(
                `Device reconnected; stream resume failed: ${errorText(error)}`,
              );
            });
          return;
        }

        const disconnectedSerial = activeSerialRef.current;
        if (
          !disconnectedSerial ||
          next.connected.some(
            (device) => device.serial === disconnectedSerial,
          )
        ) {
          return;
        }

        void sessionQueueRef.current
          .run(async () => {
            if (
              activeSerialRef.current !== disconnectedSerial ||
              transport.get(disconnectedSerial)
            ) {
              return;
            }
            const shouldResume =
              appSettingsRef.current.connection.autoReconnect &&
              appSettingsRef.current.connection.resumeStream &&
              next.pending.some(
                (item) =>
                  item.descriptor.serial === disconnectedSerial &&
                  item.stage === "reconnecting",
              );
            resumeSerialRef.current = shouldResume ? disconnectedSerial : "";
            activeSerialRef.current = "";
            setActiveSerial("");
            setControlMode("play");
            setBusy(true);
            try {
              await releaseAllInput(true);
              await session.stop();
              if (!shouldResume) {
                const fallback = transport.connected[0];
                if (fallback) {
                  await activateDeviceNow(fallback.descriptor.serial, false);
                }
              }
              showNotice(
                shouldResume
                  ? `Device ${disconnectedSerial} disconnected; waiting for USB reconnect.`
                  : `Device ${disconnectedSerial} disconnected.`,
              );
            } finally {
              setBusy(false);
            }
          })
          .catch((error) => {
            diagnostics.error(
              "scrcpy",
              "disconnect-cleanup-failed",
              `Could not finish cleanup after ${disconnectedSerial} disconnected.`,
              error,
            );
          });
      }),
    [
      activateDevice,
      activateDeviceNow,
      diagnostics,
      releaseAllInput,
      session,
      showNotice,
      transport,
    ],
  );
  useEffect(() => session.subscribe(setSessionState), [session]);
  useEffect(() => session.subscribeClipboard(setRemoteClipboard), [session]);
  useEffect(
    () => diagnostics.subscribe((next) => setEntries([...next])),
    [diagnostics],
  );

  useEffect(() => {
    if (!browserReady || !settingsReady) return;
    diagnostics.info(
      "browser",
      "capability-scan",
      missing.length === 0
        ? "Required browser capabilities are available."
        : `Missing required browser capabilities: ${missing
            .map((item) => item.label)
            .join(", ")}.`,
      browser,
    );
    void transport.startTrackingDevices().then((devices) => {
      if (devices[0]) setSelectedDevice(devices[0].serial);
    });
    void repository.ensureDefault().then(async (initial) => {
      setProfile(initial);
      setProfiles(await repository.list());
    });
  }, [
    browser,
    browserReady,
    diagnostics,
    missing,
    repository,
    settingsReady,
    transport,
  ]);

  useEffect(() => {
    if (!profile) return;
    const timer = window.setTimeout(() => {
      void repository
        .save(profile)
        .then((saved) => {
          setProfiles((items) =>
            items.map((item) => (item.id === saved.id ? saved : item)),
          );
        })
        .catch((error) => {
          diagnostics.error(
            "profile",
            "autosave-failed",
            "Could not save the active profile.",
            error,
          );
          showNotice(`Profile save failed: ${errorText(error)}`);
        });
    }, 450);
    return () => window.clearTimeout(timer);
  }, [diagnostics, profile, repository, showNotice]);

  useEffect(() => {
    profileRef.current = profile;
  }, [profile]);

  useEffect(() => {
    const initialProfile = profileRef.current;
    if (!initialProfile) return;
    const engine = new MappingEngine(
      {
        touch: (event) => {
          const control = session.control;
          if (!control) return Promise.reject(new Error("Control is unavailable"));
          return control.touch(event);
        },
      },
      initialProfile,
      {
        diagnostics,
        getVideoSize: () => session.videoSize,
        onEmergency: () => {
          setControlMode("edit");
          if (document.pointerLockElement) void document.exitPointerLock();
          showNotice("Mappings paused; all synthetic touches released.");
        },
      },
    );
    engineRef.current = engine;
    return () => {
      void engine.setEnabled(false);
      if (engineRef.current === engine) engineRef.current = null;
    };
  }, [diagnostics, profileReady, session, showNotice]);

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine || !profile) return;
    void engine
      .configure(
        profile,
        streamOrientation,
        controlMode === "play" && streaming && !busy,
      )
      .catch((error) => {
        diagnostics.error(
          "control",
          "mapping-configuration-failed",
          "Could not apply the current mapping context.",
          error,
        );
      });
  }, [
    busy,
    controlMode,
    diagnostics,
    profile,
    streamOrientation,
    streaming,
  ]);

  useEffect(() => {
    const onPointerLockChange = () => {
      const active = document.pointerLockElement === surfaceRef.current;
      setPointerLocked(active);
      if (!active) {
        setCameraLockActive(false);
      }
      void engineRef.current?.setPointerLockActive(active);
      if (!active) void session.control?.releaseMouseButtons();
    };

    const onPointerLockError = (event: Event) => {
      pointerLockRequestRef.current = false;
      setPointerLocked(false);
      setCameraLockActive(false);
      void engineRef.current?.setPointerLockActive(false);
      void session.control?.releaseMouseButtons();
      diagnostics.warn(
        "control",
        "pointer-lock-error",
        "The browser reported a Pointer Lock error.",
        event,
      );
    };

    const onPointerMove = (event: Event) => {
      if (document.pointerLockElement !== surfaceRef.current) return;
      const surface = surfaceRef.current;
      if (!surface) return;

      const mouseEvent = event as MouseEvent;
      let deltaX = 0;
      let deltaY = 0;

      if (
        "getCoalescedEvents" in event &&
        typeof (event as PointerEvent).getCoalescedEvents === "function"
      ) {
        const coalesced = (event as PointerEvent).getCoalescedEvents();
        if (coalesced && coalesced.length > 0) {
          for (let i = 0; i < coalesced.length; i++) {
            deltaX += coalesced[i]!.movementX;
            deltaY += coalesced[i]!.movementY;
          }
        } else {
          deltaX = mouseEvent.movementX;
          deltaY = mouseEvent.movementY;
        }
      } else {
        deltaX = mouseEvent.movementX;
        deltaY = mouseEvent.movementY;
      }

      if (deltaX === 0 && deltaY === 0) return;

      if (controlMode === "play" && hasMouseLook && cameraLockActive) {
        void engineRef.current?.handleMouseMove(
          deltaX,
          deltaY,
          surface.clientWidth,
          surface.clientHeight,
        );
      } else {
        void session.control?.mouseMoveRelative(
          deltaX,
          deltaY,
        );
      }
    };

    const moveEvent = typeof window !== "undefined" && "PointerEvent" in window
      ? "pointermove"
      : "mousemove";

    document.addEventListener("pointerlockchange", onPointerLockChange);
    document.addEventListener("pointerlockerror", onPointerLockError);
    document.addEventListener(moveEvent, onPointerMove);
    return () => {
      document.removeEventListener("pointerlockchange", onPointerLockChange);
      document.removeEventListener("pointerlockerror", onPointerLockError);
      document.removeEventListener(moveEvent, onPointerMove);
    };
  }, [cameraLockActive, controlMode, diagnostics, hasMouseLook, session]);

  useEffect(() => {
    const ownsKeyboardFocus = () => {
      const active = document.activeElement;
      return Boolean(
        surfaceRef.current &&
          (active === surfaceRef.current || surfaceRef.current.contains(active)),
      );
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (!streaming || busy || isEditableTarget(event.target)) {
        return;
      }
      if (controlMode === "play" && hasMouseLook) {
        const isEnable =
          Boolean(cameraLockEnableKey) && event.code === cameraLockEnableKey;
        const isDisable =
          Boolean(cameraLockDisableKey) && event.code === cameraLockDisableKey;
        if (cameraLockActive && (isDisable || isEnable)) {
          event.preventDefault();
          event.stopPropagation();
          void disableCameraLock();
          return;
        } else if (!cameraLockActive && isEnable) {
          event.preventDefault();
          event.stopPropagation();
          void enableCameraLock();
          return;
        }
      }
      if (controlMode === "play" && mappedCodes.has(event.code)) {
        event.preventDefault();
        event.stopPropagation();
        capturedMappingKeysRef.current.add(event.code);
        void engineRef.current?.handleKeyDown(event.code, event.repeat);
        return;
      }
      if (!ownsKeyboardFocus()) return;
      const route = routeKeyboardInput(
        controlMode,
        event.code,
        mappedCodes,
      );
      if (route !== "android") {
        event.preventDefault();
        event.stopPropagation();
        if (route === "mapping") {
          void engineRef.current?.handleKeyDown(event.code, event.repeat);
        }
        return;
      }
      if (
        (event.ctrlKey || event.metaKey) &&
        event.code === "KeyV" &&
        navigator.clipboard?.readText
      ) {
        event.preventDefault();
        void navigator.clipboard
          .readText()
          .then((text) => session.control?.setClipboard(text, true))
          .catch((error) =>
            diagnostics.warn(
              "control",
              "clipboard-read-failed",
              "Desktop clipboard read was denied.",
              error,
            ),
          );
        return;
      }
      const androidCode = domCodeToAndroid(event.code);
      if (androidCode === undefined) return;
      const control = session.control;
      if (!control) return;
      event.preventDefault();
      const metaState = androidMetaState(event);
      directKeysRef.current.press({
        domCode: event.code,
        androidCode,
        metaState,
      });
      void control
        .key({
          code: androidCode,
          action: "down",
          repeat: event.repeat ? 1 : 0,
          metaState,
        })
        .catch(() => {});
    };
    const onKeyUp = (event: KeyboardEvent) => {
      const capturedMapping =
        capturedMappingKeysRef.current.delete(event.code);
      const directKey = directKeysRef.current.release(event.code);
      if (
        controlMode === "play" &&
        hasMouseLook &&
        (event.code === cameraLockEnableKey || event.code === cameraLockDisableKey)
      ) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (capturedMapping || directKey) {
        event.preventDefault();
        event.stopPropagation();
        if (capturedMapping) {
          void engineRef.current?.handleKeyUp(event.code).catch(() => {});
        }
        if (directKey) {
          void session.control
            ?.key({
              code: directKey.androidCode,
              action: "up",
              metaState: directKey.metaState,
            })
            .catch(() => {});
        }
        return;
      }
      if (!streaming || busy || isEditableTarget(event.target)) {
        return;
      }
      if (controlMode === "play" && mappedCodes.has(event.code)) {
        event.preventDefault();
        event.stopPropagation();
        void engineRef.current?.handleKeyUp(event.code);
        return;
      }
      if (!ownsKeyboardFocus()) return;
      const route = routeKeyboardInput(
        controlMode,
        event.code,
        mappedCodes,
      );
      if (route !== "android") {
        event.preventDefault();
        event.stopPropagation();
        if (route === "mapping") {
          void engineRef.current?.handleKeyUp(event.code);
        }
        return;
      }
    };
    const release = () => {
      void releaseAllInput(true);
    };
    const onVisibility = () => {
      if (document.visibilityState !== "visible") release();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", release);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", release);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [
    busy,
    cameraLockActive,
    cameraLockDisableKey,
    cameraLockEnableKey,
    controlMode,
    diagnostics,
    disableCameraLock,
    enableCameraLock,
    hasMouseLook,
    mappedCodes,
    releaseAllInput,
    session,
    streaming,
  ]);

  useEffect(() => {
    if (!streaming || !activeSerial) return;
    let scheduled = false;
    const timer = window.setInterval(() => {
      const serial = activeSerialRef.current;
      if (!serial || scheduled) return;
      scheduled = true;
      void sessionQueueRef.current
        .run(async () => {
          const current = transport.get(serial);
          if (
            !current ||
            activeSerialRef.current !== serial ||
            session.snapshot.phase !== "streaming"
          ) {
            return;
          }
          let stoppedForInventory = false;
          try {
            const update = await session.refreshDynamicDisplayState(current.adb);
            if (!update || activeSerialRef.current !== serial) return;

            let capabilities = update.capabilities;
            let shouldRestart =
              update.focusedDisplayChanged &&
              qualityRef.current.displayId === undefined;
            if (update.inventoryRefreshRequired) {
              setBusy(true);
              await releaseAllInput(true);
              await session.stop();
              stoppedForInventory = true;
              capabilities = await session.refreshCapabilities(current.adb);
              shouldRestart = true;
            }

            let nextQuality = qualityRef.current;
            const selected = nextQuality.displayId;
            if (
              selected !== undefined &&
              capabilities.displays.length > 0 &&
              !capabilities.displays.some((display) => display.id === selected)
            ) {
              nextQuality = {
                ...nextQuality,
                displayId: capabilities.recommendedDisplayId,
              };
              setQuality(nextQuality);
              shouldRestart = true;
              showNotice(
                "Selected display disappeared; switching automatically.",
              );
            }

            const canvas = canvasRef.current;
            if (
              shouldRestart &&
              canvas &&
              activeSerialRef.current === serial
            ) {
              setBusy(true);
              await releaseAllInput(true);
              await session.start(current.adb, canvas, nextQuality);
              if (
                update.focusedDisplayChanged &&
                selected === undefined
              ) {
                showNotice("Following the newly focused Android display.");
              }
            }
          } catch (error) {
            if (
              stoppedForInventory &&
              canvasRef.current &&
              activeSerialRef.current === serial &&
              transport.get(serial)
            ) {
              try {
                await session.start(
                  current.adb,
                  canvasRef.current,
                  qualityRef.current,
                );
              } catch (resumeError) {
                diagnostics.error(
                  "scrcpy",
                  "display-refresh-resume-failed",
                  "The stream could not resume after display discovery failed.",
                  resumeError,
                );
              }
            }
            throw error;
          } finally {
            setBusy(false);
          }
        })
        .catch((error) =>
          diagnostics.warn(
            "display",
            "display-refresh-failed",
            "Dynamic display refresh failed.",
            error,
          ),
        )
        .finally(() => {
          scheduled = false;
        });
    }, 8_000);
    return () => window.clearInterval(timer);
  }, [
    activeSerial,
    diagnostics,
    releaseAllInput,
    session,
    setQuality,
    showNotice,
    streaming,
    transport,
  ]);

  useEffect(
    () => () => {
      if (settingsSaveTimerRef.current !== undefined) {
        window.clearTimeout(settingsSaveTimerRef.current);
      }
      if (noticeTimerRef.current !== undefined) {
        window.clearTimeout(noticeTimerRef.current);
      }
      settingsRepository.save(appSettingsRef.current);
      transport.stopTrackingDevices();
      void (async () => {
        await releaseAllInput(true);
        await session.dispose();
        await transport.disconnectAll();
      })().catch(() => {
        // Page teardown can revoke WebUSB before asynchronous cleanup finishes.
      });
    },
    [releaseAllInput, session, settingsRepository, transport],
  );

  const runConnection = async (
    operation: () => ReturnType<
      WebUsbAdbTransport["requestAndConnect"]
    >,
  ) => {
    void session.unlockAudio().catch((error) => {
      diagnostics.debug(
        "audio",
        "audio-unlock-deferred",
        "Computer audio will request activation again after connection.",
        error,
      );
    });
    if (missing.length > 0) {
      setPanel("diagnostics");
      showNotice("This browser is missing a required capability.");
      return;
    }
    try {
      const device = await operation();
      if (!device) return;
      setSelectedDevice(device.descriptor.serial);
      await activateDevice(device.descriptor.serial);
    } catch (error) {
      if (error instanceof Error && error.name === "ConnectionCancelledError") {
        return;
      }
      showNotice(`Connection failed: ${errorText(error)}`);
      setPanel("diagnostics");
    }
  };

  const disconnect = (serial = activeSerial): Promise<void> => {
    if (!serial) return Promise.resolve();
    return sessionQueueRef.current
      .run(async () => {
        if (resumeSerialRef.current === serial) {
          resumeSerialRef.current = "";
        }
        const wasActive = serial === activeSerialRef.current;
        if (wasActive) {
          activeSerialRef.current = "";
          setActiveSerial("");
          setBusy(true);
          setControlMode("play");
        }
        try {
          if (wasActive) {
            await releaseAllInput(true);
            await session.stop();
          }
          await transport.disconnect(serial);
          const fallback = transport.connected[0];
          setSelectedDevice(fallback?.descriptor.serial ?? "");
          if (wasActive && fallback) {
            await activateDeviceNow(fallback.descriptor.serial, false);
          }
          showNotice(`Disconnected ${serial}.`);
        } finally {
          if (wasActive) setBusy(false);
        }
      })
      .catch((error) => {
        showNotice(`Disconnect failed: ${errorText(error)}`);
        diagnostics.error(
          "adb",
          "disconnect-failed",
          `Could not disconnect ${serial}.`,
          error,
        );
      });
  };

  const disconnectAll = (): Promise<void> =>
    sessionQueueRef.current
      .run(async () => {
        activeSerialRef.current = "";
        resumeSerialRef.current = "";
        setActiveSerial("");
        setBusy(true);
        setControlMode("play");
        try {
          await releaseAllInput(true);
          await session.stop();
          await transport.disconnectAll();
          setSelectedDevice("");
          showNotice("Disconnected all devices.");
        } finally {
          setBusy(false);
        }
      })
      .catch((error) => {
        showNotice(`Disconnect failed: ${errorText(error)}`);
        diagnostics.error(
          "adb",
          "disconnect-all-failed",
          "Could not disconnect every device.",
          error,
        );
      });

  const restartStream = async (): Promise<void> => {
    void session.unlockAudio().catch((error) =>
      diagnostics.debug(
        "audio",
        "audio-unlock-deferred",
        "Computer audio remains blocked until a user gesture is accepted.",
        error,
      ),
    );
    await sessionQueueRef.current.run(async () => {
      const serial = activeSerialRef.current;
      const current = transport.get(serial);
      const canvas = canvasRef.current;
      if (!current || !canvas) return;
      setBusy(true);
      try {
        await releaseAllInput(true);
        await session.start(current.adb, canvas, qualityRef.current);
        if (activeSerialRef.current === serial) {
          showNotice("Stream settings applied.");
        }
      } catch (error) {
        showNotice(`Stream restart failed: ${errorText(error)}`);
        setPanel("diagnostics");
      } finally {
        setBusy(false);
      }
    });
  };

  const refreshCapabilities = async (): Promise<void> => {
    await sessionQueueRef.current.run(async () => {
      const serial = activeSerialRef.current;
      const current = transport.get(serial);
      if (!current) return;
      const canvas = canvasRef.current;
      const wasStreaming = session.snapshot.phase === "streaming";
      let restartAttempted = false;
      setBusy(true);
      try {
        if (wasStreaming) {
          await releaseAllInput(true);
          await session.stop();
        }
        const capabilities = await session.refreshCapabilities(current.adb);
        let nextQuality = qualityRef.current;
        if (
          nextQuality.displayId !== undefined &&
          capabilities.displays.length > 0 &&
          !capabilities.displays.some(
            (display) => display.id === nextQuality.displayId,
          )
        ) {
          nextQuality = {
            ...nextQuality,
            displayId: capabilities.recommendedDisplayId,
          };
          setQuality(nextQuality);
        }
        if (
          wasStreaming &&
          canvas &&
          activeSerialRef.current === serial &&
          transport.get(serial)
        ) {
          restartAttempted = true;
          await session.start(current.adb, canvas, nextQuality);
        }
        showNotice("Displays and encoders refreshed.");
      } catch (error) {
        if (
          wasStreaming &&
          !restartAttempted &&
          canvas &&
          activeSerialRef.current === serial &&
          transport.get(serial)
        ) {
          try {
            await session.start(current.adb, canvas, qualityRef.current);
          } catch (resumeError) {
            diagnostics.error(
              "scrcpy",
              "capability-refresh-resume-failed",
              "The stream could not resume after capability discovery failed.",
              resumeError,
            );
          }
        }
        showNotice(`Capability refresh failed: ${errorText(error)}`);
        setPanel("diagnostics");
      } finally {
        setBusy(false);
      }
    });
  };

  const chooseProfile = async (id: string) => {
    if (profile && profile.id !== id) {
      const savedCurrent = await repository.save(profile);
      setProfiles((items) =>
        items.map((item) =>
          item.id === savedCurrent.id ? savedCurrent : item,
        ),
      );
    }
    const selected =
      profiles.find((item) => item.id === id) ?? (await repository.get(id));
    if (!selected) return;
    await releaseAllInput(true);
    setCameraLockActive(false);
    setProfile(selected);
    setSelectedMappingId(selected.mappings[0]?.id);
  };

  const addMapping = (type: GameMapping["type"]) => {
    if (!profile) return;
    const mapping = createMapping(type);
    updateProfile({ ...profile, mappings: [...profile.mappings, mapping] });
    setSelectedMappingId(mapping.id);
    setCameraLockActive(false);
    changeControlMode("edit");
  };

  const changeMapping = (mapping: GameMapping) => {
    if (!profile) return;
    updateProfile({
      ...profile,
      mappings: profile.mappings.map((item) =>
        item.id === mapping.id ? mapping : item,
      ),
    });
  };

  const moveMapping = (id: string, position: NormalizedPoint) => {
    if (!profile) return;
    updateProfile({
      ...profile,
      mappings: profile.mappings.map((mapping) =>
        mapping.id === id ? { ...mapping, position } : mapping,
      ),
    });
  };

  const moveSwipeEnd = (id: string, end: NormalizedPoint) => {
    if (!profile) return;
    updateProfile({
      ...profile,
      mappings: profile.mappings.map((mapping) =>
        mapping.id === id && mapping.type === "swipe"
          ? { ...mapping, end }
          : mapping,
      ),
    });
  };

  const deleteMapping = (id: string) => {
    if (!profile) return;
    updateProfile({
      ...profile,
      mappings: profile.mappings.filter((mapping) => mapping.id !== id),
    });
    setSelectedMappingId(undefined);
  };

  const createNewProfile = async () => {
    if (profile) await repository.save(profile);
    const next = await repository.save(
      createProfile(`Profile ${profiles.length + 1}`),
    );
    updateProfile(next);
    setSelectedMappingId(undefined);
    setCameraLockActive(false);
    changeControlMode("edit");
  };

  const duplicateProfile = async () => {
    if (!profile) return;
    await releaseAllInput(true);
    setCameraLockActive(false);
    const now = new Date().toISOString();
    const next: GameProfile = {
      ...structuredClone(profile),
      id: createId("profile"),
      name: `${profile.name} copy`,
      createdAt: now,
      updatedAt: now,
      mappings: profile.mappings.map((mapping) => ({
        ...mapping,
        id: createId("mapping"),
      })),
    };
    const saved = await repository.save(next);
    updateProfile(saved);
    setSelectedMappingId(saved.mappings[0]?.id);
  };

  const deleteProfile = async () => {
    if (!profile || !window.confirm(`Delete “${profile.name}” from this browser?`)) {
      return;
    }
    await releaseAllInput(true);
    setCameraLockActive(false);
    await repository.delete(profile.id);
    let remaining = (await repository.list()).filter(
      (item) => item.id !== profile.id,
    );
    if (remaining.length === 0) {
      const replacement = await repository.save(createProfile("Default controls"));
      remaining = [replacement];
    }
    setProfiles(remaining);
    setProfile(remaining[0]);
    setSelectedMappingId(remaining[0]?.mappings[0]?.id);
  };

  const importProfiles = async (files: readonly File[]) => {
    const result = await importProfileFiles(
      files,
      repository,
      importPreferences,
    );
    const refreshed = await repository.list();
    setProfiles(refreshed);
    const lastImported = result.imported.at(-1);
    if (lastImported && importPreferences.activateAfterImport) {
      await releaseAllInput(true);
      setCameraLockActive(false);
      setProfile(lastImported);
      setSelectedMappingId(lastImported.mappings[0]?.id);
    } else if (
      profile &&
      result.imported.some((item) => item.id === profile.id)
    ) {
      const replacement = refreshed.find((item) => item.id === profile.id);
      if (replacement) setProfile(replacement);
    }

    const summary = [
      `${result.imported.length} imported`,
      result.skipped ? `${result.skipped} skipped` : "",
      result.failures.length ? `${result.failures.length} failed` : "",
    ]
      .filter(Boolean)
      .join(", ");
    showNotice(
      result.failures.length
        ? `Profile import: ${summary}. ${result.failures[0]}`
        : `Profile import complete: ${summary}.`,
    );
  };

  const saveProfileNow = async () => {
    if (!profile) return;
    try {
      const saved = await repository.save(profile);
      updateProfile(saved);
      showNotice(
        `Saved ${saved.mappings.length} mappings to “${saved.name}”.`,
      );
    } catch (error) {
      showNotice(`Profile save failed: ${errorText(error)}`);
    }
  };

  const toggleControlMode = () => {
    const next = controlMode === "play" ? "edit" : "play";
    if (next === "edit") setPanel("mappings");
    changeControlMode(next);
  };

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else if (fullscreenRef.current?.requestFullscreen) {
        await fullscreenRef.current.requestFullscreen();
      }
    } catch (error) {
      diagnostics.warn(
        "browser",
        "fullscreen-failed",
        "The browser did not allow the fullscreen transition.",
        error,
      );
      showNotice("Fullscreen was blocked by the browser.");
    }
  };

  const pasteDesktopClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      await session.control?.setClipboard(text, true);
      showNotice("Desktop clipboard pasted on Android.");
    } catch (error) {
      showNotice(`Clipboard read failed: ${errorText(error)}`);
    }
  };

  const injectText = async () => {
    const text = window.prompt(
      "Type text to send directly to the focused Android field:",
      "",
    );
    if (text === null || text.length === 0) return;
    try {
      await session.control?.text(text);
      showNotice("Text sent to Android.");
    } catch (error) {
      showNotice(`Text input failed: ${errorText(error)}`);
    }
  };

  const copyRemoteClipboard = async () => {
    if (!remoteClipboard) {
      showNotice("Android has not sent clipboard text yet.");
      return;
    }
    try {
      await navigator.clipboard.writeText(remoteClipboard);
      showNotice("Android clipboard copied.");
    } catch (error) {
      showNotice(`Clipboard write failed: ${errorText(error)}`);
    }
  };

  const copyDiagnostics = async () => {
    try {
      await navigator.clipboard.writeText(diagnostics.export());
      showNotice("Diagnostics copied.");
    } catch (error) {
      showNotice(`Copy failed: ${errorText(error)}`);
    }
  };

  const chooseDevice = (serial: string) => {
    void session.unlockAudio().catch((error) =>
      diagnostics.debug(
        "audio",
        "audio-unlock-deferred",
        "Computer audio remains blocked until a user gesture is accepted.",
        error,
      ),
    );
    setSelectedDevice(serial);
    if (!transport.get(serial) || serial === activeSerialRef.current) return;
    void activateDevice(serial).catch((error) => {
      showNotice(`Device switch failed: ${errorText(error)}`);
      setPanel("diagnostics");
    });
  };

  return (
    <main className="app-shell">
      <ConnectionChrome
        transport={transportState}
        browserReady={browserReady}
        missingCapabilities={missing.map((item) => item.label)}
        selectedDevice={selectedDevice}
        activeSerial={activeSerial}
        streaming={streaming}
        busy={busy}
        mode={controlMode}
        onSelectDevice={chooseDevice}
        onReconnect={(serial) =>
          void runConnection(() => transport.connectAuthorized(serial))
        }
        onConnect={() =>
          void runConnection(() => transport.requestAndConnect())
        }
        onToggleMode={toggleControlMode}
        onDisconnect={(serial) => void disconnect(serial)}
        onDisconnectAll={() => void disconnectAll()}
        onCancel={(serial) => {
          if (resumeSerialRef.current === serial) {
            resumeSerialRef.current = "";
          }
          transport.cancel(serial);
        }}
        onShowDiagnostics={() => setPanel("diagnostics")}
      />

      <div className="workbench">
        <div className="stage-column">
          <VideoStage
            canvasRef={canvasRef}
            surfaceRef={surfaceRef}
            fullscreenRef={fullscreenRef}
            videoSize={{
              width: sessionState.stats.width,
              height: sessionState.stats.height,
            }}
            streaming={streaming}
            status={sessionState.error ?? sessionState.message}
            profile={profile}
            selectedMappingId={selectedMappingId}
            mode={controlMode}
            overlaysVisible={overlaysVisible}
            mappedMouseButtons={mouseButtons}
            hasMouseLook={hasMouseLook}
            cameraLockActive={cameraLockActive}
            mouseMode={effectiveMouseMode}
            pointerLocked={pointerLocked}
            onSelectMapping={setSelectedMappingId}
            onMoveMapping={moveMapping}
            onMoveSwipeEnd={moveSwipeEnd}
            onDirectTouch={(phase, pointerId, point, buttons, actionButton) => {
              void session.control?.directTouch(
                phase,
                pointerId,
                point,
                buttons,
                actionButton,
              );
            }}
            onGameMouseDown={(button) => {
              void engineRef.current?.handleMouseDown(button);
            }}
            onGameMouseUp={(button) => {
              void engineRef.current?.handleMouseUp(button);
            }}
            onMouseMove={(point, buttons) => {
              void session.control?.mouseMove(point, buttons);
            }}
            onMouseMoveRelative={(x, y) => {
              void session.control?.mouseMoveRelative(x, y);
            }}
            onMouseButton={(point, button, pressed, buttons) => {
              void session.control?.mouseButton(
                point,
                button,
                pressed,
                buttons,
              );
            }}
            onReleaseMouseButtons={() => {
              void session.control?.releaseMouseButtons();
            }}
            onScroll={(point, x, y, buttons) => {
              void session.control?.scroll(point, x, y, buttons);
            }}
            onRequestPointerLock={() => void requestPointerLock()}
          />

          <StageStatusBar
            streaming={streaming}
            stats={sessionState.stats}
            audio={sessionState.audio}
            mouseMode={effectiveMouseMode}
            pointerLocked={pointerLocked}
            hasMouseLook={hasMouseLook}
            cameraLockActive={cameraLockActive}
            cameraLockEnableKey={cameraLockEnableKey}
            cameraLockDisableKey={cameraLockDisableKey}
            overlaysVisible={overlaysVisible}
            onToggleOverlays={() =>
              setOverlaysVisible((value) => !value)
            }
            onToggleCameraLock={() => void toggleCameraLock()}
          />

          <AndroidControlDock
            streaming={streaming}
            fullscreenSupported={browser.fullscreen}
            clipboardReadSupported={browser.clipboardRead}
            clipboardWriteSupported={browser.clipboardWrite}
            onBack={() => void session.control?.back()}
            onHome={() => void session.control?.home()}
            onRecents={() => void session.control?.appSwitch()}
            onRotate={() => void session.control?.rotate()}
            onVolumeDown={() => void session.control?.volumeDown()}
            onVolumeUp={() => void session.control?.volumeUp()}
            onPower={() => void session.control?.power()}
            onText={() => void injectText()}
            onPaste={() => void pasteDesktopClipboard()}
            onCopy={() => void copyRemoteClipboard()}
            onFullscreen={() => void toggleFullscreen()}
          />
        </div>

        <aside className="side-panel">
          <WorkspaceTabs
            active={panel}
            mappingCount={profile?.mappings.length ?? 0}
            hasErrors={entries.some((entry) => entry.level === "error")}
            onChange={setPanel}
          />

          <div className="panel-content">
            {panel === "mappings" ? (
              <MappingPanel
                profile={profile}
                selectedId={selectedMappingId}
                mode={controlMode}
                onModeChange={changeControlMode}
                onSelect={setSelectedMappingId}
                onAdd={addMapping}
                onChange={changeMapping}
                onDelete={deleteMapping}
              />
            ) : null}
            {panel === "stream" ? (
              <StreamPanel
                quality={quality}
                connection={connectionPreferences}
                capabilities={sessionState.capabilities}
                stats={sessionState.stats}
                audio={sessionState.audio}
                audioSupported={browser.webAudio}
                streaming={streaming}
                busy={busy}
                onChange={setQuality}
                onConnectionChange={changeConnectionPreferences}
                onApply={() => void restartStream()}
                onRefresh={() => void refreshCapabilities()}
                onResumeAudio={() =>
                  void session.unlockAudio().catch((error) =>
                    showNotice(`Audio activation failed: ${errorText(error)}`),
                  )
                }
                onReset={resetQuality}
              />
            ) : null}
            {panel === "profiles" ? (
              <ProfilePanel
                profiles={profiles}
                active={profile}
                onSelect={(id) => void chooseProfile(id)}
                onChange={updateProfile}
                onNew={() => void createNewProfile()}
                onDuplicate={() => void duplicateProfile()}
                onDelete={() => void deleteProfile()}
                importPreferences={importPreferences}
                onImportPreferencesChange={changeImportPreferences}
                onImport={(files) => void importProfiles(files)}
                onSave={() => void saveProfileNow()}
                onExport={() => {
                  if (!profile) return;
                  downloadText(
                    `${safeFilename(profile.name)}.json`,
                    serializeProfile(profile),
                  );
                }}
              />
            ) : null}
            {panel === "diagnostics" ? (
              <DiagnosticsPanel
                entries={entries}
                checks={checks}
                browser={browser}
                android={sessionState.capabilities}
                onCopy={() => void copyDiagnostics()}
                onExport={() =>
                  downloadText("opendroid-diagnostics.json", diagnostics.export())
                }
                onClear={() => diagnostics.clear()}
              />
            ) : null}
          </div>
        </aside>
      </div>

      {notice ? (
        <div className="toast" role="status">
          {notice}
        </div>
      ) : null}
    </main>
  );
}
