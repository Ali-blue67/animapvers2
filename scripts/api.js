// Talks to the Cloudflare Worker (/api/...). If the Worker isn't reachable
// (for example when opening the files locally) the site still works for
// guests using the built-in data; only the admin features are unavailable.
import { applyOverrides } from './campus-data.js';

const API = '/api';

export const state = {
  admin: false,
  online: false,
  overrides: {}, // { roomId: { name?, unavailable? } }
  models: {}, // { levelId: { version, size } } for admin-uploaded models
};

const emit = () => window.dispatchEvent(new CustomEvent('animap:data'));

async function request(path, { method = 'GET', body, raw } = {}) {
  const headers = {};
  if (method !== 'GET') headers['X-Requested-With'] = 'animap';
  if (body !== undefined && !raw) headers['Content-Type'] = 'application/json';
  const res = await fetch(API + path, {
    method,
    headers,
    credentials: 'same-origin',
    body: raw ? raw : body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = {};
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export async function loadConfig() {
  try {
    const cfg = await request('/config');
    state.overrides = cfg.overrides || {};
    state.models = cfg.models || {};
    state.online = true;
  } catch {
    state.online = false;
  }
  applyOverrides(state.overrides);
  emit();
}

export async function loadSession() {
  try {
    state.admin = (await request('/me')).admin === true;
  } catch {
    state.admin = false;
  }
  emit();
}

export async function bootstrap() {
  await Promise.all([loadConfig(), loadSession()]);
}

export async function login(password) {
  await request('/login', { method: 'POST', body: { password } });
  state.admin = true;
  emit();
}

export async function logout() {
  try { await request('/logout', { method: 'POST' }); } catch { /* ignore */ }
  state.admin = false;
  emit();
}

export async function saveRoom(roomId, { name, unavailable }) {
  await request(`/rooms/${roomId}`, { method: 'PUT', body: { name, unavailable } });
  await loadConfig();
}

export async function resetRoom(roomId) {
  await request(`/rooms/${roomId}`, { method: 'DELETE' });
  await loadConfig();
}

export async function uploadModel(levelId, file) {
  await request(`/models/${levelId}`, { method: 'PUT', raw: file });
  await loadConfig();
}

export async function deleteModel(levelId) {
  await request(`/models/${levelId}`, { method: 'DELETE' });
  await loadConfig();
}

// The admin-uploaded model if there is one, otherwise the .glb shipped in /models.
export function modelUrlFor(levelId) {
  const m = state.models[levelId];
  return m ? `${API}/models/${levelId}?v=${m.version}` : `models/${levelId}.glb`;
}