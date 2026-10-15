// Serve profile-aware install manifests at stable HTTPS URLs.
// Deliberately leave every page, asset, and backend request on the network.
const base = new URL("./", self.location.href);
self.addEventListener("install", event => event.waitUntil(self.skipWaiting()));
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);
  if (url.origin !== base.origin || url.pathname !== new URL("manifest.webmanifest", base).pathname || !url.searchParams.has("user")) return;
  const userId = url.searchParams.get("user");
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(userId)) return;
  event.respondWith((async () => {
    const response = await fetch(new URL("manifest.webmanifest", base), { cache: "no-store" });
    if (!response.ok) return response;
    const manifest = await response.json();
    const start = new URL(base);
    start.searchParams.set("user", userId);
    manifest.id = base.href; // Same identity as the original root start_url.
    manifest.scope = base.href;
    manifest.start_url = start.href;
    manifest.icons = (manifest.icons || []).map(icon => ({ ...icon, src: new URL(icon.src, base).href }));
    return new Response(JSON.stringify(manifest), { headers: { "Content-Type": "application/manifest+json", "Cache-Control": "no-store" } });
  })());
});
