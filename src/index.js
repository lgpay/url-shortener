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
  :root{
    --card:#fff; --ink:#1a1a1a; --muted:#8a8f98; --line:#e8ebef;
    --primary:#111; --danger:#e5484d; --accent:#4f46e5;
  }
  html, body { margin:0; padding:0; }
  body{
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,"PingFang SC","Microsoft YaHei",sans-serif;
    background:linear-gradient(180deg,#f7f9fc 0%,#eef1f6 100%);
    color:var(--ink); min-height:100vh; -webkit-font-smoothing:antialiased;
  }
  header{ display:flex; align-items:center; justify-content:space-between; padding:18px 24px; max-width:720px; margin:0 auto; }
  .brand{ font-weight:700; font-size:16px; letter-spacing:.3px; }
  main{ max-width:560px; margin:4vh auto 60px; padding:0 20px; }
  .card{ background:var(--card); border:1px solid var(--line); border-radius:18px; padding:28px; box-shadow:0 10px 30px rgba(20,30,50,.06); margin-bottom:20px; }
  h1{ font-size:22px; font-weight:700; margin:0 0 6px; }
  h2{ font-size:16px; font-weight:700; margin:0; }
  .sub{ color:var(--muted); font-size:13px; margin:0 0 18px; }
  .row{ display:flex; gap:10px; }
  input, textarea{
    width:100%; font-size:15px; color:var(--ink); background:#fbfbfc;
    border:1px solid var(--line); border-radius:12px; padding:13px 15px; outline:none;
    transition:border-color .15s, box-shadow .15s; font-family:inherit;
  }
  input:focus, textarea:focus{ border-color:var(--primary); box-shadow:0 0 0 3px rgba(17,17,17,.08); background:#fff; }
  textarea{ resize:vertical; min-height:96px; line-height:1.5; }
  .field{ margin-top:14px; }
  label{ display:block; font-size:13px; color:var(--muted); margin-bottom:6px; }
  .btn-primary{
    background:var(--primary); color:#fff; border:none; border-radius:12px;
    padding:0 22px; font-size:15px; font-weight:600; cursor:pointer; white-space:nowrap; height:48px;
    transition:opacity .15s;
  }
  .btn-primary:hover{ opacity:.88; }
  button{ font-family:inherit; }
  .btn-ghost{
    background:#fff; color:var(--ink); border:1px solid var(--line); border-radius:10px;
    padding:9px 16px; font-size:14px; cursor:pointer; transition:background .15s, border-color .15s;
  }
  .btn-ghost:hover{ background:#f6f7f9; border-color:#d8dce2; }
  .btn-ghost.sm{ padding:6px 12px; font-size:13px; }
  .btn-link{ background:none; border:none; color:var(--accent); font-size:13px; cursor:pointer; padding:14px 0 0; font-weight:600; }
  #result{ margin-top:16px; }
  .item{
    background:#fbfbfc; border:1px solid var(--line); border-radius:12px;
    padding:14px 16px; margin-top:10px; word-break:break-all; overflow:hidden;
    max-height:300px;
    display:flex; justify-content:space-between; align-items:center; gap:12px;
    transition:opacity .22s ease, transform .22s ease, max-height .22s ease, margin .22s ease, padding .22s ease;
  }
  .item.removing{ opacity:0; transform:translateX(10px); max-height:0; margin-top:0; padding-top:0; padding-bottom:0; border-color:transparent; }
  .item a.code{ font-weight:700; color:var(--ink); text-decoration:none; font-size:15px; }
  .item a.code:hover{ text-decoration:underline; }
  .muted{ color:var(--muted); font-size:12.5px; margin-top:4px; }
  .list-head{ display:flex; align-items:center; justify-content:space-between; margin-bottom:14px; }
  .tag{ display:inline-block; font-size:11px; padding:1px 7px; border-radius:6px; margin-left:8px; vertical-align:middle; }
  .tag.public{ background:#eef2ff; color:#4f46e5; }
  .tag.admin{ background:#ecfdf3; color:#067647; }
  .del{ background:var(--danger); color:#fff; border:none; border-radius:9px; padding:7px 13px; font-size:13px; cursor:pointer; white-space:nowrap; }
  .del:hover{ opacity:.9; }
  .empty{ color:var(--muted); text-align:center; padding:24px 0; font-size:14px; }
  #msg{ margin:14px 2px; color:var(--danger); font-size:14px; min-height:1px; }
  .hidden{ display:none !important; }
  .modal{ position:fixed; inset:0; display:flex; align-items:center; justify-content:center; z-index:50; }
  .modal-mask{ position:absolute; inset:0; background:rgba(15,23,42,.45); backdrop-filter:blur(2px); }
  .modal-card{ position:relative; background:#fff; border-radius:18px; padding:26px; width:360px; max-width:90vw; box-shadow:0 20px 60px rgba(15,23,42,.25); }
  .modal-card h3{ margin:0 0 4px; font-size:18px; }
  .modal-actions{ display:flex; gap:10px; justify-content:flex-end; margin-top:18px; }
</style>
</head>
<body>
<header>
  <div class="brand">短链</div>
  <button id="loginBtn" class="btn-ghost">登录</button>
</header>
<main>
  <div class="card">
    <h1>短链接</h1>
    <p class="sub">把长链接变成清爽的短链接</p>
    <div class="row">
      <input id="url" placeholder="粘贴要缩短的长链接…" />
      <button id="genBtn" class="btn-primary">生成</button>
    </div>

    <div id="adminOnly" class="hidden">
      <button id="advBtn" class="btn-link">高级选项 ▾</button>
      <div id="advPanel" class="hidden">
        <div class="field">
          <label>自定义短码（可选）</label>
          <input id="custom" placeholder="例如：my-link" />
        </div>
        <div class="field">
          <label>有效期（天，可选；留空=长期）</label>
          <input id="expireDays" type="number" min="1" placeholder="例如：30" />
        </div>
        <div class="field">
          <label>批量生成（每行一个 URL）</label>
          <textarea id="batch" placeholder="https://example.com/a&#10;https://example.com/b"></textarea>
        </div>
      </div>
    </div>

    <div id="result"></div>
  </div>

  <div id="listWrap" class="card hidden">
    <div class="list-head">
      <h2>短链列表</h2>
      <button id="allToggle" class="btn-ghost sm">管理所有短链</button>
    </div>
    <div id="list"></div>
    <button id="moreBtn" class="btn-ghost sm hidden">加载更多</button>
  </div>
  <div id="msg"></div>
</main>

<div id="loginModal" class="modal hidden">
  <div class="modal-mask"></div>
  <div class="modal-card">
    <h3>管理员登录</h3>
    <p class="sub">输入 ADMIN_TOKEN 以管理短链</p>
    <input id="tokenInput" type="password" placeholder="ADMIN_TOKEN" />
    <div class="modal-actions">
      <button id="loginCancel" class="btn-ghost">取消</button>
      <button id="loginSubmit" class="btn-primary">登录</button>
    </div>
  </div>
</div>
<script>
var TOKEN = localStorage.getItem('admin_token') || '';
var listCursor = null;
var showAll = false;
function el(id){ return document.getElementById(id); }
function apiHeaders(){
  var h = { 'Content-Type': 'application/json' };
  if (TOKEN) h['Authorization'] = 'Bearer ' + TOKEN;
  return h;
}
function setLoggedIn(on){
  el('loginBtn').textContent = on ? '退出' : '登录';
  el('adminOnly').classList.toggle('hidden', !on);
  el('listWrap').classList.toggle('hidden', !on);
  if (!on){ el('allToggle').textContent = '管理所有短链'; showAll = false; el('list').innerHTML = ''; }
}
function openLogin(){
  el('loginModal').classList.remove('hidden');
  setTimeout(function(){ el('tokenInput').focus(); }, 50);
}
function closeLogin(){ el('loginModal').classList.add('hidden'); el('tokenInput').value = ''; }
function submitLogin(){
  var t = el('tokenInput').value.trim();
  if (!t) return;
  TOKEN = t; localStorage.setItem('admin_token', TOKEN);
  closeLogin(); setLoggedIn(true); loadList(true);
}
function toggleLogin(){
  if (TOKEN){ TOKEN = ''; localStorage.removeItem('admin_token'); setLoggedIn(false); }
  else openLogin();
}
function toggleAdvanced(){
  var hidden = el('advPanel').classList.toggle('hidden');
  el('advBtn').textContent = hidden ? '高级选项 ▾' : '高级选项 ▴';
}
function gen(){
  el('msg').textContent = '';
  var urlVal = el('url').value.trim();
  var batchVal = el('batch').value.trim();
  var isAdmin = !!TOKEN;
  var endpoint, body;
  if (isAdmin && batchVal){
    var urls = batchVal.split('\\n').map(function(s){ return s.trim(); }).filter(Boolean);
    endpoint = '/api/admin/shorten'; body = { urls: urls };
  } else if (isAdmin){
    endpoint = '/api/admin/shorten'; body = { url: urlVal };
    var custom = el('custom').value.trim();
    var days = el('expireDays').value.trim();
    if (custom) body.custom = custom;
    if (days) body.expireDays = parseInt(days, 10);
  } else {
    endpoint = '/api/shorten'; body = { url: urlVal };
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
      var d = document.createElement('div'); d.className = 'item';
      if (it.error){ d.textContent = it.url + ' → ' + it.error; }
      else { var a = document.createElement('a'); a.className = 'code'; a.href = it.shortUrl; a.target = '_blank'; a.textContent = it.shortUrl; d.appendChild(a); }
      box.appendChild(d);
    });
    if (TOKEN) loadList(true);
    return;
  }
  if (data.shortUrl){
    var d = document.createElement('div'); d.className = 'item';
    var a = document.createElement('a'); a.className = 'code'; a.href = data.shortUrl; a.target = '_blank'; a.textContent = data.shortUrl;
    d.appendChild(a); box.appendChild(d);
    if (TOKEN) loadList(true);
  }
}
function loadList(reset){
  if (reset){ listCursor = null; el('list').innerHTML = ''; }
  var scope = showAll ? 'all' : 'mine';
  var q = '?scope=' + scope + (listCursor ? ('&cursor=' + encodeURIComponent(listCursor)) : '');
  fetch('/api/admin/links' + q, { headers: apiHeaders() })
    .then(function(r){ return r.json(); })
    .then(function(data){
      if (reset && (!data.links || !data.links.length)){ el('list').innerHTML = '<div class="empty">暂无短链，去生成一个吧</div>'; }
      else { (data.links || []).forEach(addRow); }
      listCursor = data.cursor;
      el('moreBtn').classList.toggle('hidden', !listCursor);
    })
    .catch(function(e){ el('msg').textContent = '加载列表失败: ' + e; });
}
function toggleAll(){
  showAll = !showAll;
  el('allToggle').textContent = showAll ? '仅看我的短链' : '管理所有短链';
  loadList(true);
}
function addRow(link){
  var row = document.createElement('div'); row.className = 'item'; row.dataset.code = link.code;
  var left = document.createElement('div'); left.style.flex = '1'; left.style.minWidth = '0';
  var a = document.createElement('a'); a.className = 'code'; a.href = '/' + link.code; a.target = '_blank'; a.textContent = '/' + link.code;
  var u = document.createElement('div'); u.className = 'muted'; u.textContent = link.url;
  var exp = document.createElement('div'); exp.className = 'muted';
  exp.textContent = link.expireAt ? ('过期: ' + new Date(link.expireAt).toLocaleString()) : '永久';
  left.appendChild(a); left.appendChild(u); left.appendChild(exp);
  if (showAll){
    var tag = document.createElement('span');
    tag.className = 'tag ' + (link.source === 'public' ? 'public' : 'admin');
    tag.textContent = link.source === 'public' ? '公开' : '管理员';
    a.appendChild(tag);
  }
  var del = document.createElement('button'); del.className = 'del'; del.textContent = '删除';
  del.onclick = function(){ delLink(link); };
  row.appendChild(left); row.appendChild(del);
  el('list').appendChild(row);
}
function delLink(link){
  var code = link.code;
  // 乐观更新：点击即播放退出动画并移除该行，DELETE 在后台静默执行
  var row = el('list').querySelector('[data-code="' + code + '"]');
  if (row){
    row.classList.add('removing');
    setTimeout(function(){ if (row.parentNode) row.remove(); }, 240);
  }
  fetch('/api/admin/links/' + code, { method:'DELETE', headers: apiHeaders() })
    .then(function(r){ return r.json().then(function(d){ return { ok: r.ok, d: d }; }); })
    .then(function(res){
      if (!res.ok){
        el('msg').textContent = '删除失败: ' + (res.d.error || '未知错误');
        addRow(link); // 失败回滚：重新插入该行
      }
    })
    .catch(function(e){
      el('msg').textContent = '删除失败: ' + e;
      addRow(link); // 网络异常回滚
    });
}
el('loginBtn').onclick = toggleLogin;
el('loginSubmit').onclick = submitLogin;
el('loginCancel').onclick = closeLogin;
el('loginModal').addEventListener('click', function(e){ if (e.target.classList.contains('modal-mask')) closeLogin(); });
el('genBtn').onclick = gen;
el('advBtn').onclick = toggleAdvanced;
el('allToggle').onclick = toggleAll;
el('moreBtn').onclick = function(){ loadList(false); };
el('tokenInput').addEventListener('keydown', function(e){ if (e.key === 'Enter') submitLogin(); });
if (TOKEN) setLoggedIn(true);
</script>
</body>
</html>`;

const NOT_FOUND_HTML = `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>短链不存在</title>
<style>
  * { box-sizing: border-box; }
  body{
    margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,"PingFang SC","Microsoft YaHei",sans-serif;
    background:linear-gradient(180deg,#f7f9fc 0%,#eef1f6 100%); color:#1a1a1a;
  }
  .card{ background:#fff; border:1px solid #e8ebef; border-radius:18px; padding:40px 44px; text-align:center; box-shadow:0 10px 30px rgba(20,30,50,.06); }
  .code{ font-size:64px; font-weight:800; margin:0; letter-spacing:1px; }
  .sub{ color:#8a8f98; font-size:15px; margin:10px 0 22px; }
  a{ display:inline-block; background:#111; color:#fff; text-decoration:none; border-radius:12px; padding:11px 22px; font-size:15px; font-weight:600; }
  a:hover{ opacity:.88; }
</style>
</head>
<body>
  <div class="card">
    <p class="code">404</p>
    <p class="sub">短链接不存在或已过期</p>
    <a href="/">返回首页</a>
  </div>
</body>
</html>`;

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
        if (body.expireDays) ttl = parseInt(body.expireDays, 10) * 86400; // 以天为单位
        else if (body.expireIn) ttl = parseInt(body.expireIn, 10);
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
        const scope = url.searchParams.get("scope") || "mine"; // mine=仅管理员, all=含公开
        const cursor = url.searchParams.get("cursor") || undefined;
        const listed = await env.LINKS.list({ prefix: "link:", cursor, limit: 50 });
        let links = await Promise.all(
          listed.keys.map(async (k) => {
            let meta = {};
            try {
              meta = JSON.parse((await env.LINKS.get(k.name)) || "{}");
            } catch {}
            return { code: k.name.slice("link:".length), ...meta };
          })
        );
        if (scope === "mine") links = links.filter((l) => l.source === "admin");
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
