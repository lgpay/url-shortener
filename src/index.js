// 短域名服务 (类 t.cn) — Cloudflare Workers + KV
// 双入口：公开(6位/1年) 与 管理员(4位+自定义+可永久)

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
const PUBLIC_CODE_LEN = 6;
const ADMIN_CODE_LEN = 4;
const PUBLIC_TTL = 365 * 24 * 3600; // 1 年，恰好为 KV expirationTtl 上限
const RATE_LIMIT = 10; // 公开入口每分钟每 IP 上限
const RATE_WINDOW = 60; // 秒

function randCode(len) {
  let s = "";
  for (let i = 0; i < len; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return s;
}

// 生成一个未占用的随机短码（冲突重试）
async function genUniqueCode(len, kv) {
  for (let i = 0; i < 12; i++) {
    const code = randCode(len);
    if (!(await kv.get(code))) return code;
  }
  throw new Error("生成短码冲突，请重试");
}

// URL 合法性 + SSRF 防护（仅 http/https，拦截私有地址）
function isSafeUrl(input) {
  let u;
  try {
    u = new URL(input);
  } catch {
    return false;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  const host = u.hostname.toLowerCase();
  if (host === "localhost" || host === "[::1]" || host === "::1") return false;
  if (host.startsWith("fe80") || host.startsWith("fc") || host.startsWith("fd")) return false;
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const a = +m[1],
      b = +m[2];
    if (a === 10) return false; // 10.0.0.0/8
    if (a === 127) return false; // 回环
    if (a === 0) return false;
    if (a === 169 && b === 254) return false; // 链路本地
    if (a === 172 && b >= 16 && b <= 31) return false; // 172.16.0.0/12
    if (a === 192 && b === 168) return false; // 192.168.0.0/16
    if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT
  }
  return true;
}

function isAuthed(request, env) {
  const auth = request.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  return !!token && token === env.ADMIN_TOKEN;
}

function clientIp(request) {
  return request.headers.get("CF-Connecting-IP") || "unknown";
}

// 公开入口限速：KV 计数器 + TTL 窗口
async function checkRateLimit(request, env) {
  const key = "ratelimit:" + clientIp(request);
  const cur = parseInt((await env.LINKS.get(key)) || "0", 10);
  if (cur >= RATE_LIMIT) return false;
  await env.LINKS.put(key, String(cur + 1), { expirationTtl: RATE_WINDOW });
  return true;
}

// 计算 TTL（秒），<60 KV 会报错，做下限保护
function clampTtl(ttl) {
  if (!ttl) return undefined;
  return ttl < 60 ? 60 : ttl;
}

// 写入一条短链。ttl 缺省表示永久
async function saveLink(env, { url, code, source, ttl }) {
  const expireAt = ttl ? Date.now() + ttl * 1000 : null;
  const value = JSON.stringify({ url, createdAt: Date.now(), source, expireAt });
  const opts = ttl ? { expirationTtl: ttl } : undefined;
  await env.LINKS.put("link:" + code, value, opts);
  return code;
}

async function createOne(env, { url, custom, ttl, source }) {
  if (!isSafeUrl(url)) throw new Error("URL 非法或存在安全风险");
  let code;
  if (custom) {
    code = custom;
    if (await env.LINKS.get("link:" + code)) throw new Error("自定义短码已被占用");
  } else {
    code = await genUniqueCode(source === "admin" ? ADMIN_CODE_LEN : PUBLIC_CODE_LEN, env.LINKS);
  }
  ttl = clampTtl(ttl);
  await saveLink(env, { url, code, source, ttl });
  return code;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

// ---------- 管理后台页（极简）----------
const ADMIN_HTML = `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>短链服务</title>
<style>
  * { box-sizing: border-box; }
  body { margin:0; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif; background:#f7f7f8; color:#222; }
  header { display:flex; justify-content:flex-end; padding:16px 20px; }
  main { max-width:560px; margin:6vh auto; padding:0 20px; }
  h1 { font-size:20px; font-weight:600; margin:0 0 24px; }
  input, textarea, button { font-size:15px; border-radius:10px; border:1px solid #ddd; padding:12px 14px; width:100%; background:#fff; }
  textarea { resize:vertical; min-height:80px; }
  .row { display:flex; gap:10px; }
  button { width:auto; background:#222; color:#fff; border:none; cursor:pointer; padding:12px 20px; }
  button:hover { opacity:.9; }
  #loginBtn { width:auto; }
  .field { margin-top:12px; }
  .hidden { display:none; }
  #result { margin-top:20px; }
  .item { background:#fff; border:1px solid #eee; border-radius:10px; padding:12px 14px; margin-top:10px; word-break:break-all; }
  .muted { color:#888; font-size:13px; margin-top:4px; }
  .list .item { display:flex; justify-content:space-between; align-items:center; gap:10px; }
  a { color:#222; text-decoration:none; }
  a:hover { text-decoration:underline; }
  .del { background:#d33; padding:6px 12px; font-size:13px; }
  #msg { margin-top:14px; color:#c33; font-size:14px; }
</style>
</head>
<body>
<header><button id="loginBtn">登录</button></header>
<main>
  <h1>短链接</h1>
  <div class="row">
    <input id="url" placeholder="粘贴要缩短的长链接…" />
    <button id="genBtn">生成</button>
  </div>
  <div id="adminFields" class="hidden">
    <div class="field"><input id="custom" placeholder="自定义短码（可选）" /></div>
    <div class="field"><input id="expire" placeholder="有效期（秒，可选；留空=长期）" /></div>
    <div class="field"><textarea id="batch" placeholder="批量：每行一个 URL（可选）"></textarea></div>
  </div>
  <div id="result"></div>
  <div id="listWrap" class="list hidden">
    <h1 style="margin-top:36px">我的短链</h1>
    <div id="list"></div>
    <button id="moreBtn" class="hidden" style="margin-top:12px">加载更多</button>
  </div>
  <div id="msg"></div>
</main>
<script>
var TOKEN = localStorage.getItem('admin_token') || '';
function el(id){ return document.getElementById(id); }
function apiHeaders(){
  var h = { 'Content-Type': 'application/json' };
  if (TOKEN) h['Authorization'] = 'Bearer ' + TOKEN;
  return h;
}
function setLoggedIn(on){
  el('loginBtn').textContent = on ? '退出登录' : '登录';
  el('adminFields').classList.toggle('hidden', !on);
  el('listWrap').classList.toggle('hidden', !on);
}
function login(){
  if (TOKEN) { TOKEN=''; localStorage.removeItem('admin_token'); setLoggedIn(false); return; }
  var t = prompt('请输入管理员 Token');
  if (t) { TOKEN = t.trim(); localStorage.setItem('admin_token', TOKEN); setLoggedIn(true); loadList(true); }
}
function gen(){
  el('msg').textContent = '';
  var urlVal = el('url').value.trim();
  var batchVal = el('batch').value.trim();
  var isAdmin = !!TOKEN;
  var endpoint, body;
  if (isAdmin && batchVal){
    var urls = batchVal.split('\\n').map(function(s){return s.trim();}).filter(Boolean);
    endpoint = '/api/admin/shorten';
    body = { urls: urls };
  } else if (isAdmin){
    endpoint = '/api/admin/shorten';
    body = { url: urlVal };
    var custom = el('custom').value.trim();
    var exp = el('expire').value.trim();
    if (custom) body.custom = custom;
    if (exp) body.expireIn = parseInt(exp, 10);
  } else {
    endpoint = '/api/shorten';
    body = { url: urlVal };
  }
  fetch(endpoint, { method:'POST', headers: apiHeaders(), body: JSON.stringify(body) })
    .then(function(r){ return r.json(); })
    .then(renderResult)
    .catch(function(e){ el('msg').textContent = '请求失败: ' + e; });
}
function renderResult(data){
  var box = el('result');
  box.innerHTML = '';
  if (data.error){ el('msg').textContent = '错误: ' + data.error; return; }
  if (data.results){
    data.results.forEach(function(it){
      var d = document.createElement('div'); d.className='item';
      if (it.error){ d.textContent = it.url + ' → ' + it.error; }
      else { var a=document.createElement('a'); a.href=it.shortUrl; a.target='_blank'; a.textContent=it.shortUrl; d.appendChild(a); }
      box.appendChild(d);
    });
    if (TOKEN) loadList(true);
    return;
  }
  if (data.shortUrl){
    var d = document.createElement('div'); d.className='item';
    var a = document.createElement('a'); a.href=data.shortUrl; a.target='_blank'; a.textContent=data.shortUrl;
    d.appendChild(a); box.appendChild(d);
    if (TOKEN) loadList(true);
  }
}
var listCursor = null;
function loadList(reset){
  if (reset){ listCursor = null; el('list').innerHTML=''; }
  var q = listCursor ? ('?cursor=' + encodeURIComponent(listCursor)) : '';
  fetch('/api/admin/links' + q, { headers: apiHeaders() })
    .then(function(r){ return r.json(); })
    .then(function(data){
      (data.links||[]).forEach(addRow);
      listCursor = data.cursor;
      el('moreBtn').classList.toggle('hidden', !listCursor);
    })
    .catch(function(e){ el('msg').textContent = '加载列表失败: ' + e; });
}
function addRow(link){
  var row = document.createElement('div'); row.className='item';
  var left = document.createElement('div');
  var a = document.createElement('a'); a.href='/' + link.code; a.target='_blank'; a.textContent='/' + link.code;
  var u = document.createElement('div'); u.className='muted'; u.textContent = link.url;
  var exp = document.createElement('div'); exp.className='muted';
  exp.textContent = link.expireAt ? ('过期: ' + new Date(link.expireAt).toLocaleString()) : '永久';
  left.appendChild(a); left.appendChild(u); left.appendChild(exp);
  var del = document.createElement('button'); del.className='del'; del.textContent='删除';
  del.onclick = function(){ delLink(link.code); };
  row.appendChild(left); row.appendChild(del);
  el('list').appendChild(row);
}
function delLink(code){
  fetch('/api/admin/links/' + code, { method:'DELETE', headers: apiHeaders() })
    .then(function(){ loadList(true); })
    .catch(function(e){ el('msg').textContent = '删除失败: ' + e; });
}
el('loginBtn').onclick = login;
el('genBtn').onclick = gen;
el('moreBtn').onclick = function(){ loadList(false); };
if (TOKEN) setLoggedIn(true);
</script>
</body>
</html>`;

const NOT_FOUND_HTML = `<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>404</title>
<style>body{font-family:system-ui,sans-serif;background:#f7f7f8;color:#222;display:flex;height:100vh;align-items:center;justify-content:center;margin:0}div{text-align:center}h1{font-size:48px;margin:0}p{color:#888}</style>
</head><body><div><h1>404</h1><p>短链接不存在或已过期</p></div></body></html>`;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const method = request.method;
    const path = url.pathname;

    try {
      // 管理后台页
      if (path === "/" && method === "GET") {
        return new Response(ADMIN_HTML, {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }

      // 公开生成（免登录，限速，仅 6 位随机，1 年）
      if (path === "/api/shorten" && method === "POST") {
        if (!(await checkRateLimit(request, env))) {
          return json({ error: "请求过于频繁，请稍后再试" }, 429);
        }
        const body = await request.json().catch(() => ({}));
        const target = body.url;
        if (!target) return json({ error: "缺少 url 字段" }, 400);
        if (!isSafeUrl(target)) return json({ error: "URL 非法或存在安全风险" }, 400);
        const code = await createOne(env, { url: target, source: "public", ttl: PUBLIC_TTL });
        return json({ code, shortUrl: url.origin + "/" + code });
      }

      // 管理员生成（单条或批量，4 位默认 + 自定义 + 可永久）
      if (path === "/api/admin/shorten" && method === "POST") {
        if (!isAuthed(request, env)) return json({ error: "未授权" }, 401);
        const body = await request.json().catch(() => ({}));
        if (Array.isArray(body.urls)) {
          const results = [];
          for (const item of body.urls) {
            const u = typeof item === "string" ? item : item.url;
            try {
              const code = await createOne(env, { url: u, source: "admin", ttl: undefined });
              results.push({ url: u, code, shortUrl: url.origin + "/" + code });
            } catch (e) {
              results.push({ url: u, error: e.message });
            }
          }
          return json({ results });
        }
        const target = body.url;
        if (!target) return json({ error: "缺少 url 字段" }, 400);
        let ttl;
        if (body.expireIn) ttl = parseInt(body.expireIn, 10);
        else if (body.expireAt) {
          ttl = Math.floor((Date.parse(body.expireAt) - Date.now()) / 1000);
          if (ttl <= 0) return json({ error: "expireAt 必须晚于当前时间" }, 400);
        }
        const code = await createOne(env, { url: target, custom: body.custom, ttl, source: "admin" });
        return json({ code, shortUrl: url.origin + "/" + code });
      }

      // 管理员列表
      if (path === "/api/admin/links" && method === "GET") {
        if (!isAuthed(request, env)) return json({ error: "未授权" }, 401);
        const cursor = url.searchParams.get("cursor") || undefined;
        const listed = await env.LINKS.list({ prefix: "link:", cursor, limit: 50 });
        const links = await Promise.all(
          listed.keys.map(async (k) => {
            let meta = {};
            try {
              meta = JSON.parse((await env.LINKS.get(k.name)) || "{}");
            } catch {}
            return { code: k.name.slice("link:".length), ...meta };
          })
        );
        return json({ links, cursor: listed.list_complete ? null : listed.cursor });
      }

      // 管理员删除
      if (path.startsWith("/api/admin/links/") && method === "DELETE") {
        if (!isAuthed(request, env)) return json({ error: "未授权" }, 401);
        const code = path.slice("/api/admin/links/".length);
        await env.LINKS.delete("link:" + code);
        return json({ ok: true });
      }

      // 跳转（其余路径当作短码）
      const code = path.replace(/^\/+/, "").replace(/\/+$/, "");
      if (code) {
        const raw = await env.LINKS.get("link:" + code);
        if (raw) {
          let target;
          try {
            target = JSON.parse(raw).url;
          } catch {}
          if (target) {
            return new Response(null, {
              status: 302,
              headers: { Location: target, "Cache-Control": "public, max-age=300" },
            });
          }
        }
      }
      return new Response(NOT_FOUND_HTML, {
        status: 404,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    } catch (e) {
      return json({ error: e.message || "服务器错误" }, 500);
    }
  },
};
