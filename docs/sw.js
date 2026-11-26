const C='hadabat-v7',A=['./','./manifest.json','./1-icon-192.png','./2-icon-512.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(C).then(c=>c.addAll(A)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==C).map(x=>caches.delete(x)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{const r=e.request,u=new URL(r.url);if(r.method!=='GET'||u.origin!==location.origin)return;
if(u.search.indexOf('_=')>-1||/version\.json$/.test(u.pathname)){e.respondWith(fetch(r,{cache:'no-store'}).catch(()=>caches.match(r)));return}
e.respondWith(caches.open(C).then(c=>c.match(r,{ignoreSearch:true}).then(m=>{const n=fetch(r,{cache:'no-store'}).then(res=>{if(res.ok)c.put(r,res.clone());return res}).catch(()=>m||c.match('./'));return m||n})))});
