// 短域名服务 (类 t.cn) — Cloudflare Workers + KV
// 双入口：公开(6位/1年) 与 管理员(4位+自定义+可永久)

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
const PUBLIC_CODE_LEN = 6;
const ADMIN_CODE_LEN = 4;
const PUBLIC_TTL = 365 * 24 * 3600; // 1 年，恰好为 KV expirationTtl 上限
const RATE_LIMIT = 10; // 公开入口每分钟每 IP 上限
const RATE_WINDOW = 60; // 秒
const FAVICON = "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";

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
  if (!isSafeUrl(url)) throw new Error("链接不合法");
  let code;
  if (custom) {
    code = custom;
    if (await env.LINKS.get("link:" + code)) throw new Error("短码已被占用");
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
<link rel="icon" href="data:image/png;base64,${FAVICON}">
<title>短链 · 极简短链接服务</title>
  <style>
  * { box-sizing: border-box; }
  :root{
    --card:#fff; --ink:#0f172a; --muted:#64748b; --line:#e7ebf0;
    --primary:#111827; --primary-hover:#1f2937;
    --accent:#4f46e5; --accent-soft:#eef2ff;
    --danger:#e5484d; --danger-soft:#fef2f2;
  }
  html, body { margin:0; padding:0; }
  body{
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,"PingFang SC","Microsoft YaHei",sans-serif;
    background:radial-gradient(1200px 600px at 50% -10%, #eef2ff 0%, #f7f9fc 45%, #eef1f6 100%);
    color:var(--ink); min-height:100vh; -webkit-font-smoothing:antialiased;
  }
  header{ display:flex; align-items:center; justify-content:space-between; padding:18px 24px; max-width:760px; margin:0 auto; }
  .brand{ display:flex; align-items:center; gap:10px; font-weight:800; font-size:17px; letter-spacing:.2px; }
  .logo{ width:30px; height:30px; border-radius:9px; background:linear-gradient(135deg,#6366f1,#4f46e5); display:flex; align-items:center; justify-content:center; box-shadow:0 4px 12px rgba(79,70,229,.35); }
  .logo svg{ width:17px; height:17px; }
  main{ max-width:560px; margin:6vh auto 60px; padding:0 20px; }
  .card{ background:var(--card); border:1px solid var(--line); border-radius:18px; padding:32px; box-shadow:0 12px 40px rgba(15,23,42,.08); margin-bottom:18px; }
  h1{ font-size:26px; font-weight:800; margin:0 0 8px; letter-spacing:-.3px; }
  .sub{ color:var(--muted); font-size:14px; margin:0 0 22px; line-height:1.6; }
  .row{ display:flex; gap:10px; }
  .row input{ flex:1; }
  input, textarea{
    width:100%; font-size:15px; color:var(--ink); background:#fbfcfe;
    border:1px solid var(--line); border-radius:12px; padding:14px 16px; outline:none;
    transition:border-color .15s, box-shadow .15s, background .15s; font-family:inherit;
  }
  input:focus, textarea:focus{ border-color:var(--accent); box-shadow:0 0 0 4px rgba(79,70,229,.12); background:#fff; }
  textarea{ resize:vertical; min-height:96px; line-height:1.6; }
  .field{ margin-top:16px; }
  label{ display:block; font-size:13px; color:var(--muted); margin-bottom:7px; font-weight:500; }
  .btn-primary{
    background:var(--primary); color:#fff; border:none; border-radius:12px;
    padding:0 22px; font-size:15px; font-weight:600; cursor:pointer; white-space:nowrap; height:50px;
    transition:background .15s, transform .05s; display:inline-flex; align-items:center; justify-content:center;
  }
  .btn-primary:hover{ background:var(--primary-hover); }
  .btn-primary:active{ transform:translateY(1px); }
  .btn-primary:disabled{ opacity:.6; cursor:default; }
  button{ font-family:inherit; }
  .btn-ghost{
    background:#fff; color:var(--ink); border:1px solid var(--line); border-radius:10px;
    padding:9px 16px; font-size:14px; cursor:pointer; transition:background .15s, border-color .15s;
  }
  .btn-ghost:hover{ background:#f6f7f9; border-color:#d8dce2; }
  .btn-ghost.sm{ padding:7px 13px; font-size:13px; }
  .header-actions{ display:flex; align-items:center; gap:10px; }
  .copy-btn{ background:var(--accent); color:#fff; border:none; border-radius:9px; padding:8px 14px; font-size:13px; font-weight:600; cursor:pointer; white-space:nowrap; transition:opacity .15s; }
  .copy-btn:hover{ opacity:.9; }
  .btn-link{ background:none; border:none; color:var(--accent); font-size:13px; cursor:pointer; padding:14px 0 0; font-weight:600; display:inline-flex; align-items:center; gap:4px; }
  .btn-link:hover{ text-decoration:underline; }
  #result{ margin-top:18px; display:flex; flex-direction:column; }
  .item{
    display:flex; align-items:center; gap:12px; background:#fff; border:1px solid var(--line); border-radius:14px;
    padding:14px 16px; margin-top:10px; word-break:break-all; overflow:hidden; max-height:300px;
    transition:opacity .22s ease, transform .22s ease, max-height .22s ease, margin .22s ease, padding .22s ease, box-shadow .15s;
  }
  .item:hover{ box-shadow:0 6px 18px rgba(15,23,42,.06); }
  .item.removing{ opacity:0; transform:translateX(10px); max-height:0; margin-top:0; padding-top:0; padding-bottom:0; border-color:transparent; }
  .item .meta{ flex:1; min-width:0; }
  .item .surl{ font-weight:700; color:var(--ink); text-decoration:none; font-size:15.5px; display:inline-flex; align-items:center; gap:6px; }
  .item .surl:hover{ color:var(--accent); }
  .item .orig{ color:var(--muted); font-size:12.5px; margin-top:3px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .tag{ display:inline-block; font-size:11px; padding:1px 7px; border-radius:6px; margin-left:8px; vertical-align:middle; font-weight:600; }
  .tag.public{ background:var(--accent-soft); color:#4f46e5; }
  .tag.admin{ background:#ecfdf3; color:#067647; }
  .del{ background:var(--danger-soft); color:var(--danger); border:1px solid #fbd5d7; border-radius:9px; padding:7px 14px; font-size:13px; font-weight:600; cursor:pointer; white-space:nowrap; transition:background .15s; }
  .del:hover{ background:#fde8e8; }
  .empty{ color:var(--muted); text-align:center; padding:32px 0; font-size:14px; }
  #msg{ margin:14px 2px; color:var(--danger); font-size:14px; min-height:1px; }
  .hidden{ display:none !important; }
  .modal{ position:fixed; inset:0; display:flex; align-items:center; justify-content:center; z-index:50; padding:20px; animation:fade .18s ease; }
  @keyframes fade{ from{opacity:0;} to{opacity:1;} }
  .modal-mask{ position:absolute; inset:0; background:rgba(15,23,42,.45); backdrop-filter:blur(3px); }
  .modal-card{ position:relative; background:#fff; border-radius:20px; padding:26px; width:380px; max-width:100%; max-height:86vh; display:flex; flex-direction:column; box-shadow:0 24px 70px rgba(15,23,42,.28); animation:pop .2s ease; }
  @keyframes pop{ from{ transform:translateY(10px) scale(.97); opacity:.5;} to{ transform:none; opacity:1;} }
  .modal-card.wide{ width:580px; }
  .modal-card h3{ margin:0 0 6px; font-size:19px; font-weight:800; }
  .modal-head{ display:flex; align-items:center; justify-content:space-between; margin-bottom:16px; gap:12px; }
  .modal-head-actions{ display:flex; gap:8px; }
  .modal-actions{ display:flex; gap:10px; justify-content:flex-end; margin-top:20px; }
  #list{ overflow-y:auto; flex:1; min-height:0; margin-top:2px; }
  .modal-err{ color:var(--danger); font-size:13px; margin:12px 0 0; min-height:1px; }
  </style>
</head>
<body>
<header>
  <div class="brand">
    <span class="logo"><svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/></svg></span>
    短链
  </div>
  <div class="header-actions">
    <button id="manageBtn" class="btn-ghost sm hidden">管理</button>
    <button id="loginBtn" class="btn-ghost">登录</button>
  </div>
</header>
<main>
  <div class="card">
    <h1>把长链接，变成短链接</h1>
    <p class="sub">生成易分享的短网址</p>
    <div class="row">
      <input id="url" placeholder="粘贴长链接…" />
      <button id="genBtn" class="btn-primary">生成短链</button>
    </div>

    <div id="adminOnly" class="hidden">
      <button id="advBtn" class="btn-link">更多选项 ▾</button>
      <div id="advPanel" class="hidden">
        <div class="field">
          <label>自定义短码</label>
          <input id="custom" placeholder="自定义后缀，如 promo" />
        </div>
        <div class="field">
          <label>有效期（天）</label>
          <input id="expireDays" type="number" min="1" placeholder="如 30" />
        </div>
        <div class="field">
          <label>批量生成</label>
          <textarea id="batch" placeholder="https://example.com/a&#10;https://example.com/b"></textarea>
        </div>
      </div>
    </div>

    <div id="result"></div>
  </div>

  <div id="msg"></div>
</main>

<div id="manageModal" class="modal hidden">
  <div class="modal-mask"></div>
  <div class="modal-card wide">
    <div class="modal-head">
      <h3>短链管理</h3>
      <div class="modal-head-actions">
        <button id="allToggle" class="btn-ghost sm">我的</button>
        <button id="manageClose" class="btn-ghost sm">关闭</button>
      </div>
    </div>
    <div id="list"></div>
    <button id="moreBtn" class="btn-ghost sm hidden">加载更多</button>
  </div>
</div>

<div id="loginModal" class="modal hidden">
  <div class="modal-mask"></div>
  <div class="modal-card">
    <h3>管理员</h3>
    <p class="sub">请输入管理员口令</p>
    <input id="tokenInput" type="password" placeholder="管理员口令" autocomplete="new-password" />
    <p id="loginMsg" class="modal-err"></p>
    <div class="modal-actions">
      <button id="loginCancel" class="btn-ghost">取消</button>
      <button id="loginSubmit" class="btn-primary">登录</button>
    </div>
  </div>
</div>
<script>
var TOKEN = localStorage.getItem('admin_token') || '';
var listCursor = null;
var showAll = true;
var lastSingleUrl = '';
function el(id){ return document.getElementById(id); }
function apiHeaders(){
  var h = { 'Content-Type': 'application/json' };
  if (TOKEN) h['Authorization'] = 'Bearer ' + TOKEN;
  return h;
}
function clearForm(){
  el('url').value = ''; el('result').innerHTML = '';
  el('custom').value = ''; el('expireDays').value = ''; el('batch').value = '';
  el('advPanel').classList.add('hidden'); el('advBtn').textContent = '更多选项 ▾';
  el('msg').textContent = '';
}
function setLoggedIn(on){
  el('loginBtn').textContent = on ? '退出' : '登录';
  el('adminOnly').classList.toggle('hidden', !on);
  el('manageBtn').classList.toggle('hidden', !on);
  if (!on){
    el('allToggle').textContent = '我的'; showAll = true;
    el('list').innerHTML = ''; el('manageModal').classList.add('hidden');
    el('tokenInput').value = '';
    clearForm();
  }
}
function openLogin(){
  el('loginModal').classList.remove('hidden');
  el('tokenInput').value = '';
  el('loginMsg').textContent = '';
  setTimeout(function(){ el('tokenInput').focus(); }, 50);
}
function closeLogin(){ el('loginModal').classList.add('hidden'); el('tokenInput').value = ''; }
function openManage(){
  showAll = true;
  el('allToggle').textContent = '我的';
  el('manageModal').classList.remove('hidden');
  loadList(true);
}
function closeManage(){ el('manageModal').classList.add('hidden'); }
function validateToken(t, onOk, onFail){
  fetch('/api/admin/links?scope=all&limit=1', { headers: { 'Authorization': 'Bearer ' + t } })
    .then(function(r){
      if (r.ok){ TOKEN = t; localStorage.setItem('admin_token', TOKEN); onOk(); }
      else { TOKEN = ''; localStorage.removeItem('admin_token'); if (onFail) onFail(); }
    })
    .catch(function(e){ TOKEN = ''; localStorage.removeItem('admin_token'); if (onFail) onFail(e); });
}
function submitLogin(){
  var t = el('tokenInput').value.trim();
  if (!t) return;
  el('loginMsg').textContent = '';
  validateToken(t,
    function(){ closeLogin(); clearForm(); setLoggedIn(true); loadList(true); },
    function(){ el('loginMsg').textContent = '口令错误，请重试'; }
  );
}
function toggleLogin(){
  if (TOKEN){ TOKEN = ''; localStorage.removeItem('admin_token'); setLoggedIn(false); }
  else openLogin();
}
function toggleAdvanced(){
  var hidden = el('advPanel').classList.toggle('hidden');
  el('advBtn').textContent = hidden ? '更多选项 ▾' : '更多选项 ▴';
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
    lastSingleUrl = '';
  } else if (isAdmin){
    endpoint = '/api/admin/shorten'; body = { url: urlVal };
    var custom = el('custom').value.trim();
    var days = el('expireDays').value.trim();
    if (custom) body.custom = custom;
    if (days) body.expireDays = parseInt(days, 10);
    lastSingleUrl = urlVal;
  } else {
    endpoint = '/api/shorten'; body = { url: urlVal };
    lastSingleUrl = urlVal;
  }
  var btn = el('genBtn'); var old = btn.textContent;
  btn.disabled = true; btn.textContent = '生成中…';
  fetch(endpoint, { method:'POST', headers: apiHeaders(), body: JSON.stringify(body) })
    .then(function(r){ return r.json(); })
    .then(renderResult)
    .catch(function(e){ el('msg').textContent = '网络异常，请重试'; })
    .finally(function(){ btn.disabled = false; btn.textContent = old; });
}
function linkRow(shortUrl, orig){
  var d = document.createElement('div'); d.className = 'item';
  var meta = document.createElement('div'); meta.className = 'meta';
  var a = document.createElement('a'); a.className = 'surl'; a.href = shortUrl; a.target = '_blank'; a.textContent = shortUrl;
  meta.appendChild(a);
  if (orig){ var o = document.createElement('div'); o.className = 'orig'; o.textContent = orig; meta.appendChild(o); }
  var copy = document.createElement('button'); copy.className = 'copy-btn'; copy.textContent = '复制';
  copy.onclick = function(){ copyText(shortUrl, copy); };
  d.appendChild(meta); d.appendChild(copy);
  return d;
}
function copyText(text, btn){
  var restore = function(){ btn.textContent = '复制'; };
  var done = function(){ btn.textContent = '已复制'; setTimeout(restore, 1200); };
  if (navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(text).then(done, function(){ fallbackCopy(text); done(); });
  } else { fallbackCopy(text); done(); }
}
function fallbackCopy(text){
  var ta = document.createElement('textarea');
  ta.value = text; ta.style.position = 'fixed'; ta.style.top = '-1000px'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select();
  try { document.execCommand('copy'); } catch (e) {}
  document.body.removeChild(ta);
}
function renderResult(data){
  var box = el('result');
  box.innerHTML = '';
  if (data.error){ el('msg').textContent = data.error; return; }
  if (data.results){
    data.results.forEach(function(it){
      if (it.error){ var d = document.createElement('div'); d.className = 'item'; d.style.flexDirection = 'column'; d.style.alignItems = 'flex-start'; d.style.gap = '4px'; d.textContent = it.url + ' → ' + it.error; box.appendChild(d); }
      else { box.appendChild(linkRow(it.shortUrl, it.url)); }
    });
    if (TOKEN) loadList(true);
    return;
  }
  if (data.shortUrl){
    box.appendChild(linkRow(data.shortUrl, lastSingleUrl));
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
      if (reset && (!data.links || !data.links.length)){ el('list').innerHTML = '<div class="empty">还没有短链</div>'; }
      else { (data.links || []).forEach(addRow); }
      listCursor = data.cursor;
      el('moreBtn').classList.toggle('hidden', !listCursor);
    })
    .catch(function(e){ el('msg').textContent = '列表加载失败，请重试'; });
}
function toggleAll(){
  showAll = !showAll;
  el('allToggle').textContent = showAll ? '我的' : '所有';
  loadList(true);
}
function addRow(link){
  var row = document.createElement('div'); row.className = 'item'; row.dataset.code = link.code;
  var meta = document.createElement('div'); meta.className = 'meta';
  var a = document.createElement('a'); a.className = 'surl'; a.href = '/' + link.code; a.target = '_blank'; a.textContent = '/' + link.code;
  meta.appendChild(a);
  var u = document.createElement('div'); u.className = 'orig'; u.textContent = link.url;
  meta.appendChild(u);
  var exp = document.createElement('div'); exp.className = 'orig';
  exp.textContent = link.expireAt ? ('有效期至 ' + new Date(link.expireAt).toLocaleString()) : '长期有效';
  meta.appendChild(exp);
  if (showAll){
    var tag = document.createElement('span');
    tag.className = 'tag ' + (link.source === 'public' ? 'public' : 'admin');
    tag.textContent = link.source === 'public' ? '公开' : '管理员';
    a.appendChild(tag);
  }
  var del = document.createElement('button'); del.className = 'del'; del.textContent = '删除';
  del.onclick = function(){ delLink(link); };
  row.appendChild(meta); row.appendChild(del);
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
        el('msg').textContent = '删除失败，请重试';
        addRow(link); // 失败回滚：重新插入该行
      }
    })
    .catch(function(e){
      el('msg').textContent = '删除失败，请重试';
      addRow(link); // 网络异常回滚
    });
}
el('loginBtn').onclick = toggleLogin;
el('loginSubmit').onclick = submitLogin;
el('loginCancel').onclick = closeLogin;
el('loginModal').addEventListener('click', function(e){ if (e.target.classList.contains('modal-mask')) closeLogin(); });
el('manageBtn').onclick = openManage;
el('manageClose').onclick = closeManage;
el('manageModal').addEventListener('click', function(e){ if (e.target.classList.contains('modal-mask')) closeManage(); });
el('genBtn').onclick = gen;
el('advBtn').onclick = toggleAdvanced;
el('allToggle').onclick = toggleAll;
el('moreBtn').onclick = function(){ loadList(false); };
el('tokenInput').addEventListener('keydown', function(e){ if (e.key === 'Enter') submitLogin(); });
if (TOKEN) validateToken(TOKEN, function(){ setLoggedIn(true); loadList(true); });
</script>
</body>
</html>`;

const NOT_FOUND_HTML = `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="icon" href="data:image/png;base64,${FAVICON}">
<title>短链不存在</title>
  <style>
  * { box-sizing: border-box; }
  body{
    margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,"PingFang SC","Microsoft YaHei",sans-serif;
    background:radial-gradient(1200px 600px at 50% -10%, #eef2ff 0%, #f7f9fc 45%, #eef1f6 100%); color:#0f172a;
  }
  .card{ background:#fff; border:1px solid #e7ebf0; border-radius:20px; padding:44px 48px; text-align:center; box-shadow:0 12px 40px rgba(15,23,42,.08); }
  .code{ font-size:64px; font-weight:800; margin:0; letter-spacing:1px; }
  .sub{ color:#64748b; font-size:15px; margin:10px 0 22px; }
  a{ display:inline-block; background:#111827; color:#fff; text-decoration:none; border-radius:12px; padding:11px 22px; font-size:15px; font-weight:600; transition:opacity .15s; }
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
      // favicon
      if (path === "/favicon.png" && method === "GET") {
        const bin = atob(FAVICON); const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return new Response(bytes, { headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400" } });
      }
      // 管理后台页
      if (path === "/" && method === "GET") {
        return new Response(ADMIN_HTML, {
          headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
        });
      }

      // 公开生成（免登录，限速，仅 6 位随机，1 年）
      if (path === "/api/shorten" && method === "POST") {
        if (!(await checkRateLimit(request, env))) {
          return json({ error: "请求过于频繁，请稍后再试" }, 429);
        }
        const body = await request.json().catch(() => ({}));
        const target = body.url;
        if (!target) return json({ error: "请输入链接" }, 400);
        if (!isSafeUrl(target)) return json({ error: "链接不合法" }, 400);
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
        if (!target) return json({ error: "请输入链接" }, 400);
        let ttl;
        if (body.expireDays) ttl = parseInt(body.expireDays, 10) * 86400; // 以天为单位
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
