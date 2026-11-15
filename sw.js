/* Jarvis : garde l'appli en mémoire pour qu'elle s'ouvre même sans réseau.
   Les appels au cerveau (Gemini, Groq) ne sont jamais mis en cache. */
const VERSION = "jarvis-v8";
const FICHIERS = ["./", "index.html", "css/jarvis.css", "js/app.js", "manifest.webmanifest", "briefing-exemple.json",
  "icons/icon.svg", "icons/icon-192.png", "icons/icon-512.png",
  "fonts/unbounded-latin-500-normal.woff2", "fonts/unbounded-latin-700-normal.woff2",
  "fonts/atkinson-hyperlegible-latin-400-normal.woff2", "fonts/atkinson-hyperlegible-latin-700-normal.woff2"];

self.addEventListener("install", (e) => { e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FICHIERS))); self.skipWaiting(); });
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  // Réseau d'abord (pour avoir la dernière version), mémoire si hors ligne
  e.respondWith(fetch(e.request, { cache: "no-cache" }).then((r) => { const copie = r.clone(); caches.open(VERSION).then((c) => c.put(e.request, copie)); return r; })
    .catch(() => caches.match(e.request, { ignoreSearch: true })));
});
