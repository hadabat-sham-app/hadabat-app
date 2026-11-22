// Deno Deploy version: storage in Deno KV, live sync via SSE + BroadcastChannel
const kv = await Deno.openKv();
const bc = new BroadcastChannel("hadabat");
const enc = new TextEncoder();
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
async function hash(p: string, salt: string) {
  const k = await crypto.subtle.importKey("raw", enc.encode(p), "PBKDF2", false, ["deriveBits"]);
  return hex(await crypto.subtle.deriveBits({ name: "PBKDF2", salt: enc.encode(salt), iterations: 100000, hash: "SHA-256" }, k, 256));
}
const rnd = (n: number) => hex(crypto.getRandomValues(new Uint8Array(n)).buffer);
let seqLocal = 0;
const newId = () => Date.now() * 1000 + (seqLocal++ % 1000);
async function all(kind: string): Promise<any[]> {
  const out: any[] = [];
  for await (const e of kv.list({ prefix: [kind] })) out.push(e.value);
  return out;
}
async function ensureAdmin() {
  const any = (await kv.list({ prefix: ["user"] }, { limit: 1 }).next()).value;
  if (any) return;
  const salt = rnd(8);
  const u = { id: newId(), username: Deno.env.get("ADMIN_USER") || "admin", name: "المدير", role: "admin", salt, hash: await hash(Deno.env.get("ADMIN_PASS") || "ChangeMe123", salt) };
  await kv.set(["user", u.id], u);
}
await ensureAdmin();
const clients = new Set<ReadableStreamDefaultController>();
bc.onmessage = () => ping(false);
function ping(remote = true) {
  for (const c of clients) { try { c.enqueue(enc.encode("data: change\n\n")); } catch { clients.delete(c); } }
  if (remote) bc.postMessage("c");
}
const J = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
const num = (v: any) => { const x = parseFloat(v); return isFinite(x) ? x : NaN; };
const fails: Record<string, number> = {};
function qtyOf(moves: any[], id: number) { return moves.filter((m) => m.itemId === id).reduce((a, m) => a + (m.type === "out" ? -m.qty : m.qty), 0); }
async function state() {
  const [items, moves, txs, users] = await Promise.all([all("item"), all("move"), all("tx"), all("user")]);
  moves.sort((a, b) => a.id - b.id); txs.sort((a, b) => a.id - b.id);
  return { items: items.map((i) => ({ ...i, qty: qtyOf(moves, i.id) })), moves: moves.slice(-1500), txs: txs.slice(-3000), users: users.map((u) => ({ id: u.id, username: u.username, name: u.name, role: u.role })) };
}
const mime: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".png": "image/png", ".json": "application/json" };
Deno.serve(async (req) => {
  const u = new URL(req.url), p = u.pathname;
  if (!p.startsWith("/api/")) {
    const f = p === "/" ? "/index.html" : p;
    try { const d = await Deno.readFile("./public" + f.replace(/\.\./g, "")); const ext = f.slice(f.lastIndexOf(".")); return new Response(d, { headers: { "Content-Type": mime[ext] || "application/octet-stream" } }); } catch { return new Response("404", { status: 404 }); }
  }
  const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
  if (p === "/api/login" && req.method === "POST") {
    const ip = req.headers.get("x-forwarded-for") || "x";
    if ((fails[ip] || 0) >= 10) return J({ error: "محاولات كثيرة، حاول بعد قليل" }, 429);
    const name = String(body.username || "").trim();
    const us = await all("user"); const x = us.find((x) => x.username === name.toLowerCase() || x.username === name);
    if (!x || (await hash(String(body.password || ""), x.salt)) !== x.hash) { fails[ip] = (fails[ip] || 0) + 1; setTimeout(() => fails[ip] = 0, 300000); return J({ error: "اسم المستخدم أو كلمة المرور غير صحيحة" }, 401); }
    fails[ip] = 0; const t = rnd(24); await kv.set(["session", t], x.id);
    return J({ token: t, user: { id: x.id, name: x.name, username: x.username, role: x.role } });
  }
  const tok = (req.headers.get("authorization") || "").replace("Bearer ", "") || u.searchParams.get("token") || "";
  const uid = (await kv.get(["session", tok])).value as number | null;
  const me = uid ? (await kv.get(["user", uid])).value as any : null;
  if (!me) return J({ error: "unauth" }, 401);
  if (p === "/api/events") {
    let ctrl: ReadableStreamDefaultController, hb: number;
    const s = new ReadableStream({ start(c) { ctrl = c; clients.add(c); c.enqueue(enc.encode("retry: 2000\n\n")); hb = setInterval(() => { try { c.enqueue(enc.encode(": hb\n\n")); } catch { clearInterval(hb); clients.delete(c); } }, 15000); }, cancel() { clearInterval(hb); clients.delete(ctrl); } });
    return new Response(s, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } });
  }
  if (p === "/api/state") return J({ me: { id: me.id, name: me.name, role: me.role }, ...(await state()) });
  const now = new Date().toISOString();
  const admin = me.role === "admin";
  if (p === "/api/item" && req.method === "POST") {
    const n = String(body.name || "").trim(); if (!n) return J({ error: "اكتب اسم الصنف" }, 400);
    if ((await all("item")).some((i) => i.name === n)) return J({ error: "الصنف موجود بالفعل" }, 400);
    const it = { id: newId(), name: n, unit: String(body.unit || "كجم"), min: num(body.min) || 0, cost: num(body.cost) || 0 };
    await kv.set(["item", it.id], it);
    const q = num(body.qty); if (q > 0) { const m = { id: newId(), itemId: it.id, type: "in", qty: q, price: it.cost, note: "رصيد افتتاحي", dest: "", user: me.name, at: now }; await kv.set(["move", m.id], m); }
    ping(); return J({ ok: 1 });
  }
  if (p === "/api/item/edit" && req.method === "POST") {
    const it = (await kv.get(["item", body.id])).value as any; if (!it) return J({ error: "غير موجود" }, 404);
    if (body.name) it.name = String(body.name).trim(); if (body.unit) it.unit = String(body.unit); if (!isNaN(num(body.min))) it.min = num(body.min);
    await kv.set(["item", it.id], it); ping(); return J({ ok: 1 });
  }
  if (p === "/api/item/delete" && req.method === "POST") {
    if (!admin) return J({ error: "للمدير فقط" }, 403);
    await kv.delete(["item", body.id]); for (const m of await all("move")) if (m.itemId === body.id) await kv.delete(["move", m.id]);
    ping(); return J({ ok: 1 });
  }
  if (p === "/api/move" && req.method === "POST") {
    const it = (await kv.get(["item", body.itemId])).value as any, q = num(body.qty);
    if (!it) return J({ error: "الصنف غير موجود" }, 404);
    if (!["in", "out", "adjust"].includes(body.type)) return J({ error: "نوع غير صحيح" }, 400);
    if (!(q > 0) && body.type !== "adjust") return J({ error: "اكتب كمية صحيحة" }, 400);
    const moves = await all("move"); const cur = qtyOf(moves, it.id);
    if (body.type === "out" && q > cur + 1e-9) return J({ error: "الكمية المتاحة في المخزن " + cur + " فقط" }, 400);
    let price = it.cost;
    if (body.type === "in") { const pr = num(body.price); if (pr >= 0) { price = pr; it.cost = cur + q > 0 ? (cur * it.cost + q * pr) / (cur + q) : pr; await kv.set(["item", it.id], it); } }
    const m = { id: newId(), itemId: it.id, type: body.type, qty: q, price, note: String(body.note || "").slice(0, 200), dest: body.type === "out" ? String(body.dest || "المطبخ") : "", user: me.name, at: now };
    await kv.set(["move", m.id], m); ping(); return J({ ok: 1 });
  }
  if (p === "/api/tx" && req.method === "POST") {
    const a = num(body.amount); if (!(a > 0)) return J({ error: "اكتب مبلغ صحيح" }, 400);
    const t = { id: newId(), type: body.type === "sale" ? "sale" : "expense", cat: String(body.cat || "أخرى"), amount: a, note: String(body.note || "").slice(0, 200), user: me.name, at: now };
    await kv.set(["tx", t.id], t); ping(); return J({ ok: 1 });
  }
  if (p === "/api/delete" && req.method === "POST") {
    if (!admin) return J({ error: "للمدير فقط" }, 403);
    await kv.delete(["move", body.id]); await kv.delete(["tx", body.id]); ping(); return J({ ok: 1 });
  }
  if (p === "/api/users" && req.method === "POST") {
    if (!admin) return J({ error: "للمدير فقط" }, 403);
    const un = String(body.username || "").trim().toLowerCase();
    if (!un || String(body.password || "").length < 6) return J({ error: "اسم مستخدم وكلمة مرور (٦ أحرف على الأقل)" }, 400);
    if ((await all("user")).some((x) => x.username === un)) return J({ error: "اسم المستخدم مستخدم" }, 400);
    const salt = rnd(8); const nu = { id: newId(), username: un, name: body.name || un, role: body.role === "admin" ? "admin" : "staff", salt, hash: await hash(body.password, salt) };
    await kv.set(["user", nu.id], nu); ping(); return J({ ok: 1 });
  }
  if (p === "/api/password" && req.method === "POST") {
    if (String(body.password || "").length < 6) return J({ error: "٦ أحرف على الأقل" }, 400);
    me.salt = rnd(8); me.hash = await hash(body.password, me.salt); await kv.set(["user", me.id], me); return J({ ok: 1 });
  }
  return J({ error: "not found" }, 404);
});
