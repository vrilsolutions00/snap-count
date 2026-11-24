const CACHE = "sc-v18";
const SHELL = [
  "./",
  "./index.html",
  "./css/styles.css",
  "./js/app.js",
  "./js/lb.js",
  "./manifest.webmanifest",
  "./privacy-policy.html",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-512-maskable.png",
  "./icons/apple-touch-icon.png",
  "./icons/favicon-32.png",
  "./fonts/oswald-latin.woff2",
  "./fonts/oswald-latin-ext.woff2",
  "./fonts/outfit-latin.woff2",
  "./fonts/outfit-latin-ext.woff2"
];
/* Team logos in ./logos/ are cached on first use by the fetch handler, not listed here. */

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => Promise.all(SHELL.map((url) =>
      fetch(new Request(url, { cache: "reload" })).then((res) => {
        if (!res.ok) throw new Error("shell " + url + " " + res.status);
        return c.put(url, res);
      })
    ))).then(() => self.skipWaiting())
  );
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  const isData = url.pathname.includes("/data/");
  if (isData) {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
          return res;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }
  e.respondWith(
    caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy));
      return res;
    }))
  );
});
