"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { registerServiceWorker } from "./registerServiceWorker";

export interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{
    outcome: "accepted" | "dismissed";
    platform: string;
  }>;
  prompt(): Promise<void>;
}

export interface PwaState {
  canInstall: boolean;
  isInstalled: boolean;
  isOffline: boolean;
  hasUpdate: boolean;
  isWcoVisible: boolean;
  promptInstall: () => Promise<boolean>;
  applyUpdate: () => void;
  checkForUpdates: () => Promise<boolean>;
}

export function usePwa(): PwaState {
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isOffline, setIsOffline] = useState(false);
  const [hasUpdate, setHasUpdate] = useState(false);
  const [isWcoVisible, setIsWcoVisible] = useState(false);
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(
    null,
  );
  const registrationRef = useRef<ServiceWorkerRegistration | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

    // Check if running in standalone or window-controls-overlay PWA mode
    const isStandalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      window.matchMedia("(display-mode: window-controls-overlay)").matches ||
      Boolean((navigator as unknown as { standalone?: boolean }).standalone);
    setIsInstalled(isStandalone);

    // Sync Window Controls Overlay geometry and CSS custom variables
    const syncWco = () => {
      if (typeof window === "undefined" || typeof document === "undefined") return;
      const nav = navigator as unknown as {
        windowControlsOverlay?: {
          visible: boolean;
          getTitlebarAreaRect(): DOMRect;
          addEventListener(type: string, listener: (ev: Event) => void): void;
          removeEventListener(type: string, listener: (ev: Event) => void): void;
        };
      };
      const overlay = nav.windowControlsOverlay;
      const isWco = Boolean(overlay?.visible);
      setIsWcoVisible(isWco);

      if (overlay && isWco) {
        const rect = overlay.getTitlebarAreaRect();
        const right = Math.max(0, window.innerWidth - (rect.x + rect.width));
        const left = Math.max(0, rect.x);
        const top = Math.max(0, rect.y);
        const height = Math.max(0, rect.height);
        const width = Math.max(0, rect.width);

        document.documentElement.style.setProperty("--wco-visible", "1");
        document.documentElement.style.setProperty("--wco-right", `${right}px`);
        document.documentElement.style.setProperty("--wco-left", `${left}px`);
        document.documentElement.style.setProperty("--wco-top", `${top}px`);
        document.documentElement.style.setProperty("--wco-height", `${height}px`);
        document.documentElement.style.setProperty("--wco-width", `${width}px`);
      } else {
        document.documentElement.style.setProperty("--wco-visible", "0");
        document.documentElement.style.setProperty("--wco-right", "0px");
        document.documentElement.style.setProperty("--wco-left", "0px");
        document.documentElement.style.setProperty("--wco-top", "0px");
        document.documentElement.style.setProperty("--wco-height", "0px");
        document.documentElement.style.setProperty("--wco-width", "100vw");
      }
    };

    syncWco();

    const nav = navigator as unknown as {
      windowControlsOverlay?: {
        addEventListener(type: string, listener: (ev: Event) => void): void;
        removeEventListener(type: string, listener: (ev: Event) => void): void;
      };
    };
    const overlay = nav.windowControlsOverlay;
    overlay?.addEventListener("geometrychange", syncWco);
    window.addEventListener("resize", syncWco);

    // Initial online/offline status
    setIsOffline(!navigator.onLine);

    const handleOnline = () => {
      setIsOffline(false);
      // Immediately check for service worker updates upon reconnecting to internet
      if (registrationRef.current) {
        registrationRef.current.update().catch((err) => {
          console.warn("[PWA] Update check on reconnect failed:", err);
        });
      }
    };

    const handleOffline = () => setIsOffline(true);

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible" && navigator.onLine && registrationRef.current) {
        registrationRef.current.update().catch((err) => {
          console.warn("[PWA] Update check on visibility change failed:", err);
        });
      }
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    // Capture beforeinstallprompt event
    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
    };

    const handleAppInstalled = () => {
      setDeferredPrompt(null);
      setIsInstalled(true);
    };

    window.addEventListener(
      "beforeinstallprompt",
      handleBeforeInstallPrompt as EventListener,
    );
    window.addEventListener("appinstalled", handleAppInstalled);

    // Register service worker and listen for updates
    registerServiceWorker().then((result) => {
      if (result.registration) {
        const reg = result.registration;
        registrationRef.current = reg;

        if (reg.waiting) {
          setWaitingWorker(reg.waiting);
          setHasUpdate(true);
        }

        reg.addEventListener("updatefound", () => {
          const newWorker = reg.installing;
          if (!newWorker) return;

          newWorker.addEventListener("statechange", () => {
            if (
              newWorker.state === "installed" &&
              navigator.serviceWorker.controller
            ) {
              setWaitingWorker(newWorker);
              setHasUpdate(true);
            }
          });
        });
      }
    });

    // Periodic background update check every 30 minutes when online
    const intervalTimer = window.setInterval(() => {
      if (navigator.onLine && registrationRef.current) {
        registrationRef.current.update().catch((err) => {
          console.warn("[PWA] Periodic update check failed:", err);
        });
      }
    }, 30 * 60 * 1000);

    let refreshing = false;
    navigator.serviceWorker?.addEventListener("controllerchange", () => {
      if (!refreshing) {
        refreshing = true;
        window.location.reload();
      }
    });

    return () => {
      window.clearInterval(intervalTimer);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener(
        "beforeinstallprompt",
        handleBeforeInstallPrompt as EventListener,
      );
      window.removeEventListener("appinstalled", handleAppInstalled);
      overlay?.removeEventListener("geometrychange", syncWco);
      window.removeEventListener("resize", syncWco);
    };
  }, []);

  const promptInstall = useCallback(async (): Promise<boolean> => {
    if (!deferredPrompt) return false;
    try {
      await deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice.outcome === "accepted") {
        setDeferredPrompt(null);
        return true;
      }
    } catch (err) {
      console.warn("[PWA] Install prompt failed:", err);
    }
    return false;
  }, [deferredPrompt]);

  const applyUpdate = useCallback(() => {
    if (waitingWorker) {
      waitingWorker.postMessage({ type: "SKIP_WAITING" });
    }
  }, [waitingWorker]);

  const checkForUpdates = useCallback(async (): Promise<boolean> => {
    if (!registrationRef.current || !navigator.onLine) {
      return false;
    }
    try {
      await registrationRef.current.update();
      return true;
    } catch (err) {
      console.warn("[PWA] Manual update check failed:", err);
      return false;
    }
  }, []);

  return {
    canInstall: Boolean(deferredPrompt) && !isInstalled,
    isInstalled,
    isOffline,
    hasUpdate,
    isWcoVisible,
    promptInstall,
    applyUpdate,
    checkForUpdates,
  };
}
