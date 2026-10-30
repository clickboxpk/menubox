// MenuQR service worker. It only keeps the app's own files (the "shell") so the installed app opens fast.
// It NEVER stores the API, logins, menus or orders: nothing private is saved on the phone by this file.
// Files are fetched from the network first (so a new version on GitHub shows up at once) and the saved copy is used only when the network is slow or gone.
const CACHE = 'menuqr-shell-v1';
const SHELL = ['index.html', 'config.js', 'receipt.js', 'backup.js', 'manifest.json', 'icon-192.png', 'icon-512.png'];
const TIMEOUT = 5000;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => Promise.all(SHELL.map((f) => c.add(new Request(f, { cache: 'reload' })).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith('menuqr-') && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

const OFFLINE = '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MenuQR</title><body style="font-family:system-ui;padding:32px;text-align:center"><h2>You are offline</h2><p>Please check your internet and open the app again.</p>';

function shellName(url) {
  if (url.origin !== self.location.origin) return null;
  const base = new URL('./', self.location.href).pathname;
  if (url.pathname === base) return 'index.html';
  const n = url.pathname.slice(base.length);
  return SHELL.includes(n) ? n : null;          // menu.html, terms.html, setup.html and everything else go straight to the network
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const name = shellName(new URL(req.url));
  if (!name) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const key = name;
    try {
      const net = await Promise.race([
        fetch(req.mode === 'navigate' ? new Request(name, { cache: 'no-cache' }) : new Request(req, { cache: 'no-cache' })),
        new Promise((_, rej) => setTimeout(() => rej(new Error('slow')), TIMEOUT)),
      ]);
      if (net && net.ok) { cache.put(key, net.clone()).catch(() => {}); return net; }
      const old = await cache.match(key); return old || net;
    } catch (err) {
      const old = await cache.match(key);
      if (old) return old;
      return req.mode === 'navigate' ? new Response(OFFLINE, { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }) : Response.error();
    }
  })());
});
