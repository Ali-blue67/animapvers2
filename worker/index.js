// AniMap API - Cloudflare Worker (D1 for data, R2 for 3D models).
//
// Security model (why it is hard to tamper with):
//  * Only the admin endpoints can change anything; every one needs a valid,
//    signed, expiring session cookie (HttpOnly + Secure + SameSite=Strict).
//  * The admin password is never stored - only a salted PBKDF2 hash (a Worker secret).
//  * Login is rate limited per IP (5 tries / 15 min) and every change is written to an audit log.
//  * State-changing requests must come from your own site (Origin check + custom header).
//  * Inputs are validated (ids, name length, boolean flags, .glb magic bytes and size).
//  * Guests have read-only access. There is no endpoint that lets a guest write.

const LEVELS = ['lower-ground', 'ground', 'level-2', 'level-3', 'level-4'];
const MAX_MODEL_BYTES = 40 * 1024 * 1024;
const SESSION_MS = 2 * 60 * 60 * 1000;
const MAX_TRIES = 5;
const WINDOW_MS = 15 * 60 * 1000;
const MAX_OVERRIDES = 600;
const MAX_LEGENDS = 20;
const DEFAULT_LEGENDS = ['blue', 'orange', 'yellow', 'green', 'purple', 'gray'];
const HEX = /^#[0-9a-fA-F]{6}$/;

const enc = new TextEncoder();
const SEC_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'X-Frame-Options': 'DENY',
};

const json = (body, status = 200, extra = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...SEC_HEADERS, ...extra },
  });

// ---------- small crypto helpers ----------
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const hmacKey = (secret, usages) => crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, usages);

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function verifyPassword(password, stored) {
  const [scheme, iters, saltB64, hashB64] = String(stored || '').split('$');
  if (scheme !== 'pbkdf2' || !iters || !saltB64 || !hashB64) return false;
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: unb64u(saltB64), iterations: Number(iters) }, key, 256);
  return timingSafeEqual(new Uint8Array(bits), unb64u(hashB64));
}

async function makeToken(env) {
  const payload = b64u(enc.encode(JSON.stringify({ exp: Date.now() + SESSION_MS, n: crypto.randomUUID() })));
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(env.SESSION_SECRET, ['sign']), enc.encode(payload));
  return `${payload}.${b64u(sig)}`;
}

async function readSession(request, env) {
  const raw = (request.headers.get('Cookie') || '').split(';').map((c) => c.trim()).find((c) => c.startsWith('animap_session='));
  if (!raw) return false;
  const [payload, sig] = raw.slice('animap_session='.length).split('.');
  if (!payload || !sig) return false;
  try {
    const ok = await crypto.subtle.verify('HMAC', await hmacKey(env.SESSION_SECRET, ['verify']), unb64u(sig), enc.encode(payload));
    if (!ok) return false;
    return JSON.parse(new TextDecoder().decode(unb64u(payload))).exp > Date.now();
  } catch {
    return false;
  }
}

const cookie = (env, value, maxAge) =>
  `animap_session=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Strict${env.DEV === '1' ? '' : '; Secure'}`;

const clientIp = (request) => request.headers.get('CF-Connecting-IP') || 'unknown';
const audit = (env, request, action, target) =>
  env.DB.prepare('INSERT INTO audit_log (ts, ip, action, target) VALUES (?, ?, ?, ?)').bind(Date.now(), clientIp(request), action, target || null).run();

// Blocks cross-site requests: the browser must say the request came from our own site.
function sameOrigin(request, url) {
  const origin = request.headers.get('Origin');
  return origin === url.origin && request.headers.get('X-Requested-With') === 'animap';
}

const cleanName = (s) => String(s).replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 80);
const cleanDesc = (s) => String(s).replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 40);

// ---------- handlers ----------
async function getConfig(env) {
  const [rooms, models, legendRows] = await Promise.all([
    env.DB.prepare('SELECT room_id, name, description, unavailable, legend FROM room_overrides').all(),
    env.DB.prepare('SELECT level_id, version, size FROM models').all(),
    env.DB.prepare('SELECT id, label, color FROM legends ORDER BY updated_at').all(),
  ]);
  const overrides = {};
  rooms.results.forEach((r) => (overrides[r.room_id] = { name: r.name || undefined, description: r.description === null ? undefined : r.description, unavailable: !!r.unavailable, legend: r.legend || undefined }));
  const modelMap = {};
  models.results.forEach((m) => (modelMap[m.level_id] = { version: m.version, size: m.size }));
  return json({ overrides, models: modelMap, legends: legendRows.results.map((l) => ({ id: l.id, label: l.label, color: l.color })) }, 200, { 'Cache-Control': 'public, max-age=15' });
}

async function login(request, env) {
  const ip = clientIp(request);
  const now = Date.now();
  const row = await env.DB.prepare('SELECT count, first_at FROM login_attempts WHERE ip = ?').bind(ip).first();
  let count = row && now - row.first_at < WINDOW_MS ? row.count : 0;
  if (count >= MAX_TRIES) return json({ error: 'Too many attempts. Try again in 15 minutes.' }, 429);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'Bad request' }, 400); }
  const password = typeof body.password === 'string' ? body.password.slice(0, 200) : '';

  if (!password || !(await verifyPassword(password, env.ADMIN_PASSWORD_HASH))) {
    await new Promise((r) => setTimeout(r, 400)); // slows guessing a little more
    count += 1;
    await env.DB.prepare('INSERT INTO login_attempts (ip, count, first_at) VALUES (?, ?, ?) ON CONFLICT(ip) DO UPDATE SET count = ?, first_at = CASE WHEN ? - first_at >= ? THEN ? ELSE first_at END')
      .bind(ip, count, now, count, now, WINDOW_MS, now).run();
    await audit(env, request, 'login_failed');
    return json({ error: 'Incorrect password.' }, 401);
  }

  await env.DB.prepare('DELETE FROM login_attempts WHERE ip = ?').bind(ip).run();
  await audit(env, request, 'login_ok');
  return json({ admin: true }, 200, { 'Set-Cookie': cookie(env, await makeToken(env), SESSION_MS / 1000) });
}

async function putRoom(request, env, roomId) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Bad request' }, 400); }
  const name = body.name === undefined || body.name === null ? null : cleanName(body.name);
  // description: empty = show the room number instead
  const description = body.description === undefined || body.description === null ? null : cleanDesc(body.description) || null;
  const unavailable = body.unavailable ? 1 : 0;
  // legend: a built-in colour name or the id of a legend the admin made; empty = the room's normal colour
  let legend = typeof body.legend === 'string' ? body.legend.trim() : '';
  if (legend && !DEFAULT_LEGENDS.includes(legend)) {
    const found = /^c-[a-z0-9]{6,12}$/.test(legend) ? await env.DB.prepare('SELECT id FROM legends WHERE id = ?').bind(legend).first() : null;
    if (!found) return json({ error: 'Unknown legend.' }, 400);
  }
  legend = legend || null;

  const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM room_overrides').first();
  if (count.n >= MAX_OVERRIDES) return json({ error: 'Too many overrides' }, 400);

  await env.DB.prepare('INSERT INTO room_overrides (room_id, name, description, unavailable, legend, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(room_id) DO UPDATE SET name = excluded.name, description = excluded.description, unavailable = excluded.unavailable, legend = excluded.legend, updated_at = excluded.updated_at')
    .bind(roomId, name || null, description, unavailable, legend, Date.now()).run();
  await audit(env, request, 'room_update', `${roomId} name=${name || '-'} desc=${description === null ? '-' : description} unavailable=${unavailable} legend=${legend || '-'}`);
  return json({ ok: true });
}

async function postLegend(request, env, id) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Bad request' }, 400); }
  const label = typeof body.label === 'string' ? cleanName(body.label).slice(0, 30) : '';
  const color = typeof body.color === 'string' ? body.color.trim() : '';
  if (!label) return json({ error: 'Give the legend a name.' }, 400);
  if (!HEX.test(color)) return json({ error: 'Pick a valid colour.' }, 400);
  if (!id) {
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM legends').first();
    if (n.n >= MAX_LEGENDS) return json({ error: `You can add up to ${MAX_LEGENDS} legends.` }, 400);
    id = `c-${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}`;
  }
  await env.DB.prepare('INSERT INTO legends (id, label, color, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET label = excluded.label, color = excluded.color')
    .bind(id, label, color.toLowerCase(), Date.now()).run();
  await audit(env, request, 'legend_save', `${id} ${label} ${color}`);
  return json({ ok: true, id });
}

async function putModel(request, env, level) {
  const length = Number(request.headers.get('Content-Length') || 0);
  if (!length || length > MAX_MODEL_BYTES) return json({ error: 'Model must be under 40 MB.' }, 413);
  const data = await request.arrayBuffer();
  if (data.byteLength > MAX_MODEL_BYTES) return json({ error: 'Model must be under 40 MB.' }, 413);
  // A real .glb starts with the ASCII bytes "glTF".
  if (new TextDecoder().decode(data.slice(0, 4)) !== 'glTF') return json({ error: 'That is not a .glb file.' }, 400);

  await env.MODELS.put(`models/${level}.glb`, data, { httpMetadata: { contentType: 'model/gltf-binary' } });
  const version = Date.now();
  await env.DB.prepare('INSERT INTO models (level_id, version, size, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(level_id) DO UPDATE SET version = excluded.version, size = excluded.size, updated_at = excluded.updated_at')
    .bind(level, version, data.byteLength, version).run();
  await audit(env, request, 'model_upload', `${level} ${data.byteLength}b`);
  return json({ ok: true, version });
}

async function getModel(env, level) {
  const obj = await env.MODELS.get(`models/${level}.glb`);
  if (!obj) return json({ error: 'Not found' }, 404);
  return new Response(obj.body, {
    headers: { 'Content-Type': 'model/gltf-binary', 'Cache-Control': 'public, max-age=31536000, immutable', ...SEC_HEADERS },
  });
}

// ---------- router ----------
async function route(request, env, url) {
  const { pathname: p } = url;
  const method = request.method;

  if (p === '/api/config' && method === 'GET') return getConfig(env);
  if (p === '/api/me' && method === 'GET') return json({ admin: await readSession(request, env) });

  const mModel = /^\/api\/models\/([a-z0-9-]{1,20})$/.exec(p);
  if (mModel && method === 'GET') return LEVELS.includes(mModel[1]) ? getModel(env, mModel[1]) : json({ error: 'Not found' }, 404);

  // Everything below changes data: must come from our own site.
  if (method !== 'POST' && method !== 'PUT' && method !== 'DELETE') return json({ error: 'Not found' }, 404);
  if (!sameOrigin(request, url)) return json({ error: 'Forbidden' }, 403);

  if (p === '/api/login' && method === 'POST') return login(request, env);
  if (p === '/api/logout' && method === 'POST') return json({ admin: false }, 200, { 'Set-Cookie': cookie(env, '', 0) });

  if (!(await readSession(request, env))) return json({ error: 'Sign in required' }, 401);

  const mRoom = /^\/api\/rooms\/([a-z0-9-]{3,80})$/.exec(p);
  if (mRoom && method === 'PUT') return putRoom(request, env, mRoom[1]);
  if (mRoom && method === 'DELETE') {
    await env.DB.prepare('DELETE FROM room_overrides WHERE room_id = ?').bind(mRoom[1]).run();
    await audit(env, request, 'room_reset', mRoom[1]);
    return json({ ok: true });
  }

  if (p === '/api/legends' && method === 'POST') return postLegend(request, env, null);
  const mLegend = /^\/api\/legends\/(c-[a-z0-9]{6,12})$/.exec(p);
  if (mLegend && method === 'PUT') return postLegend(request, env, mLegend[1]);
  if (mLegend && method === 'DELETE') {
    await env.DB.prepare('UPDATE room_overrides SET legend = NULL WHERE legend = ?').bind(mLegend[1]).run();
    await env.DB.prepare('DELETE FROM legends WHERE id = ?').bind(mLegend[1]).run();
    await audit(env, request, 'legend_delete', mLegend[1]);
    return json({ ok: true });
  }

  if (mModel && LEVELS.includes(mModel[1])) {
    if (method === 'PUT') return putModel(request, env, mModel[1]);
    if (method === 'DELETE') {
      await env.MODELS.delete(`models/${mModel[1]}.glb`);
      await env.DB.prepare('DELETE FROM models WHERE level_id = ?').bind(mModel[1]).run();
      await audit(env, request, 'model_delete', mModel[1]);
      return json({ ok: true });
    }
  }
  return json({ error: 'Not found' }, 404);
}

// Repairs an older database in place (e.g. tables made before "description" existed), so the
// admin never has to run migrations by hand.
async function repairDatabase(env) {
  const stmts = [
    'CREATE TABLE IF NOT EXISTS room_overrides (room_id TEXT PRIMARY KEY, name TEXT, description TEXT, unavailable INTEGER NOT NULL DEFAULT 0, legend TEXT, updated_at INTEGER NOT NULL)',
    'CREATE TABLE IF NOT EXISTS legends (id TEXT PRIMARY KEY, label TEXT NOT NULL, color TEXT NOT NULL, updated_at INTEGER NOT NULL)',
    'CREATE TABLE IF NOT EXISTS models (level_id TEXT PRIMARY KEY, version INTEGER NOT NULL, size INTEGER NOT NULL, updated_at INTEGER NOT NULL)',
    'CREATE TABLE IF NOT EXISTS login_attempts (ip TEXT PRIMARY KEY, count INTEGER NOT NULL, first_at INTEGER NOT NULL)',
    'CREATE TABLE IF NOT EXISTS audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, ip TEXT, action TEXT NOT NULL, target TEXT)',
  ];
  for (const sql of stmts) await env.DB.prepare(sql).run();
  try { await env.DB.prepare('ALTER TABLE room_overrides ADD COLUMN description TEXT').run(); } catch { /* already there */ }
  try { await env.DB.prepare('ALTER TABLE room_overrides ADD COLUMN legend TEXT').run(); } catch { /* already there */ }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    const attempt = request.clone();
    try {
      return await route(request, env, url);
    } catch (err) {
      console.error(err);
      if (/no such (column|table)|has no column/i.test(String(err && err.message))) {
        try {
          await repairDatabase(env);
          return await route(attempt, env, url);
        } catch (err2) {
          console.error(err2);
        }
      }
      return json({ error: 'Server error' }, 500);
    }
  },
};