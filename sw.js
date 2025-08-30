const CACHE = "lpic-forge-pro-v3";
const ASSETS = ["./","./index.html","./style.css","./app.js","./questions.json","./labs.json","./manifest.json"];
self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys=>Promise.all(keys.map(k=> k!==CACHE && caches.delete(k)))));
});
self.addEventListener("fetch", e => {
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request).then(res=>{
      const copy = res.clone();
      caches.open(CACHE).then(c=>c.put(e.request, copy));
      return res;
    }))
  );
});
