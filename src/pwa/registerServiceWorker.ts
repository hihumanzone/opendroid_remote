export interface ServiceWorkerRegistrationResult {
  supported: boolean;
  registration?: ServiceWorkerRegistration;
  error?: Error;
}

/**
 * Registers the PWA service worker with scope relative to the current document base URL.
 */
export async function registerServiceWorker(): Promise<ServiceWorkerRegistrationResult> {
  if (
    typeof window === "undefined" ||
    !("serviceWorker" in navigator) ||
    (window.location.protocol !== "https:" &&
      window.location.hostname !== "localhost" &&
      window.location.hostname !== "127.0.0.1")
  ) {
    return { supported: false };
  }

  try {
    const swUrl = new URL("sw.js", document.baseURI).href;
    const scope = new URL("./", document.baseURI).pathname;
    const registration = await navigator.serviceWorker.register(swUrl, {
      scope,
      updateViaCache: "none",
    });
    return { supported: true, registration };
  } catch (error) {
    console.warn("[PWA] Service worker registration failed:", error);
    return { supported: true, error: error as Error };
  }
}
