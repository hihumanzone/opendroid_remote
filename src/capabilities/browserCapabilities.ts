export interface BrowserCapabilities {
  secureContext: boolean;
  webUsb: boolean;
  webCodecs: boolean;
  webAudio: boolean;
  webGl: boolean;
  pointerEvents: boolean;
  pointerLock: boolean;
  fullscreen: boolean;
  keyboardLock: boolean;
  clipboardRead: boolean;
  clipboardWrite: boolean;
  indexedDb: boolean;
  cryptoSubtle: boolean;
}

export interface CapabilityCheck {
  id: keyof BrowserCapabilities;
  label: string;
  required: boolean;
  supported: boolean;
  detail: string;
}

function supportsWebGl(): boolean {
  if (typeof document === "undefined") return false;
  try {
    const canvas = document.createElement("canvas");
    return Boolean(
      canvas.getContext("webgl2", {
        failIfMajorPerformanceCaveat: true,
      }) ??
        canvas.getContext("webgl", {
          failIfMajorPerformanceCaveat: true,
        }),
    );
  } catch {
    return false;
  }
}

export function detectBrowserCapabilities(): BrowserCapabilities {
  const nav = typeof navigator === "undefined" ? undefined : navigator;
  const doc = typeof document === "undefined" ? undefined : document;
  return {
    secureContext:
      typeof window !== "undefined" &&
      (window.isSecureContext ||
        window.location.hostname === "localhost" ||
        window.location.hostname === "127.0.0.1"),
    webUsb: Boolean(nav && "usb" in nav),
    webCodecs:
      typeof VideoDecoder !== "undefined" &&
      typeof EncodedVideoChunk !== "undefined",
    webAudio: typeof AudioContext !== "undefined",
    webGl: supportsWebGl(),
    pointerEvents: typeof PointerEvent !== "undefined",
    pointerLock: Boolean(
      doc && "pointerLockElement" in doc && "requestPointerLock" in HTMLElement.prototype,
    ),
    fullscreen: Boolean(doc && "fullscreenEnabled" in doc && doc.fullscreenEnabled),
    keyboardLock: Boolean(
      nav && "keyboard" in nav && typeof (nav as Navigator & { keyboard?: { lock?: Function } }).keyboard?.lock === "function",
    ),
    clipboardRead: Boolean(nav?.clipboard?.readText),
    clipboardWrite: Boolean(nav?.clipboard?.writeText),
    indexedDb: typeof indexedDB !== "undefined",
    cryptoSubtle: Boolean(globalThis.crypto?.subtle),
  };
}

export function capabilityChecks(
  capabilities: BrowserCapabilities,
): CapabilityCheck[] {
  return [
    {
      id: "secureContext",
      label: "HTTPS / secure context",
      required: true,
      supported: capabilities.secureContext,
      detail: "Required by WebUSB and browser clipboard permissions.",
    },
    {
      id: "webUsb",
      label: "WebUSB",
      required: true,
      supported: capabilities.webUsb,
      detail: "Connects directly to the Android ADB USB interface.",
    },
    {
      id: "webCodecs",
      label: "WebCodecs",
      required: true,
      supported: capabilities.webCodecs,
      detail: "Decodes the negotiated scrcpy video stream with low latency.",
    },
    {
      id: "cryptoSubtle",
      label: "Web Crypto",
      required: true,
      supported: capabilities.cryptoSubtle,
      detail: "Stores ADB keys and verifies the bundled scrcpy server.",
    },
    {
      id: "pointerEvents",
      label: "Pointer Events",
      required: true,
      supported: capabilities.pointerEvents,
      detail: "Normal pointer input and independent multi-touch tracking.",
    },
    {
      id: "webGl",
      label: "WebGL",
      required: false,
      supported: capabilities.webGl,
      detail: "Preferred frame renderer; bitmap rendering is the fallback.",
    },
    {
      id: "webAudio",
      label: "Web Audio",
      required: false,
      supported: capabilities.webAudio,
      detail: "Plays the scrcpy audio stream through this computer.",
    },
    {
      id: "pointerLock",
      label: "Pointer Lock",
      required: false,
      supported: capabilities.pointerLock,
      detail:
        "Enables continuous relative motion for the physical UHID mouse and mouse-look mappings.",
    },
    {
      id: "fullscreen",
      label: "Fullscreen",
      required: false,
      supported: capabilities.fullscreen,
      detail: "Enables distraction-free play.",
    },
    {
      id: "keyboardLock",
      label: "Keyboard Lock",
      required: false,
      supported: capabilities.keyboardLock,
      detail:
        "Retains pointer lock and captures the Escape key during fullscreen.",
    },
    {
      id: "clipboardRead",
      label: "Clipboard read",
      required: false,
      supported: capabilities.clipboardRead,
      detail: "Needed to paste desktop clipboard text on Android.",
    },
    {
      id: "clipboardWrite",
      label: "Clipboard write",
      required: false,
      supported: capabilities.clipboardWrite,
      detail: "Needed for automatic Android-to-desktop clipboard sync.",
    },
    {
      id: "indexedDb",
      label: "IndexedDB",
      required: false,
      supported: capabilities.indexedDb,
      detail: "Profile persistence uses localStorage if unavailable.",
    },
  ];
}

export function missingRequiredCapabilities(
  capabilities: BrowserCapabilities,
): CapabilityCheck[] {
  return capabilityChecks(capabilities).filter(
    (item) => item.required && !item.supported,
  );
}
