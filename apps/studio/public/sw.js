// The Studio's service worker. It keeps the page itself (HTML, scripts, styles,
// icons) so the installed app opens even when the studio server is not running.
// It never touches /api: the project, its media and builds always come live
// from the server.
const CACHE = "comms-studio-v1"
const SHELL = ["/", "/manifest.webmanifest", "/icons/icon-192.png"]

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()))
})

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((name) => name !== CACHE).map((name) => caches.delete(name))))
      .then(() => self.clients.claim()),
  )
})

const keep = async (request, response) => {
  if (response.status === 200) (await caches.open(CACHE)).put(request, response.clone())
  return response
}

self.addEventListener("fetch", (event) => {
  const { request } = event
  const url = new URL(request.url)
  if (request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return

  // Built assets have a hash in their name, so a cached copy is never stale.
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(caches.match(request).then((hit) => hit ?? fetch(request).then((response) => keep(request, response))))
    return
  }
  // Everything else: the server's copy when it answers, the kept copy when it does not.
  const key = request.mode === "navigate" ? "/" : request
  event.respondWith(
    fetch(request).then((response) => keep(key, response)).catch(async () => (await caches.match(key)) ?? Response.error()),
  )
})
