/// <reference lib="webworker" />

const CACHE_NAME = "opendroid-v1.6.0";

const PRECACHE_ASSETS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./manifest.json",
  "./favicon.svg",
  "./icons/icon-32.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-512-maskable.png",
  "./icons/apple-touch-icon.png",
  "./vendor/scrcpy-server-v3.3.3",
  "./vendor/SCRCPY-LICENSE.txt",
  "./vendor/SCRCPY-SHA256.txt",
];

function fetchWithTimeout(request, timeoutMs = 2500) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("Network timeout"));
    }, timeoutMs);

    fetch(request)
      .then((response) => {
        clearTimeout(timer);
        resolve(response);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

// Install: pre-cache critical app shell & vendor scrcpy binary
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then(async (cache) => {
        // Precache items gracefully in case any single optional asset 404s
        await Promise.allSettled(
          PRECACHE_ASSETS.map(async (asset) => {
            try {
              const response = await fetch(asset, { cache: "reload" });
              if (response.ok) {
                await cache.put(asset, response);
              }
            } catch (err) {
              console.warn(`[ServiceWorker] Pre-cache skipped for ${asset}:`, err);
            }
          }),
        );
      })
      .then(() => self.skipWaiting()),
  );
});

// Activate: clean up outdated caches and claim clients immediately
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) =>
        Promise.all(
          cacheNames.map((name) => {
            if (name !== CACHE_NAME) {
              return caches.delete(name);
            }
            return undefined;
          }),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

// Fetch: smart network/cache routing
self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Only handle GET requests and http/https schemes
  if (
    request.method !== "GET" ||
    !request.url.startsWith("http")
  ) {
    return;
  }

  // Navigation requests (HTML pages): Fast network-first with timeout and offline cache fallback
  if (request.mode === "navigate") {
    event.respondWith(
      fetchWithTimeout(request, 2500)
        .then(async (networkResponse) => {
          if (networkResponse && networkResponse.ok) {
            const cache = await caches.open(CACHE_NAME);
            cache.put(request, networkResponse.clone());
          }
          return networkResponse;
        })
        .catch(async () => {
          const cachedResponse =
            (await caches.match(request)) ||
            (await caches.match("./")) ||
            (await caches.match("./index.html"));
          if (cachedResponse) {
            return cachedResponse;
          }
          return new Response(
            "<!doctype html><html><body style='background:#10130f;color:#c8f85a;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;'><h2>OpenDroid Remote (Offline)</h2></body></html>",
            { headers: { "Content-Type": "text/html" } },
          );
        }),
    );
    return;
  }

  // Static assets, bundled JS/CSS, images, fonts, and scrcpy-server binary: Cache-first with stale-while-revalidate
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      if (cachedResponse) {
        // Fetch in background to update cache for next time when online
        fetch(request)
          .then(async (networkResponse) => {
            if (networkResponse && networkResponse.ok) {
              const cache = await caches.open(CACHE_NAME);
              cache.put(request, networkResponse);
            }
          })
          .catch(() => {
            // Offline - ignore background refresh failure
          });
        return cachedResponse;
      }

      // Not in cache: fetch from network and cache
      return fetch(request).then(async (networkResponse) => {
        if (networkResponse && networkResponse.ok && networkResponse.type === "basic") {
          const cache = await caches.open(CACHE_NAME);
          cache.put(request, networkResponse.clone());
        }
        return networkResponse;
      });
    }),
  );
});

// Handle update prompts
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});
