// Admin sign-in (shared by the welcome page and the app) and the room editor.
import { state, bootstrap, login, logout, saveRoom, resetRoom } from './api.js';
import { createIcon } from './icons.js';

const el = (tag, props = {}, ...kids) => {
  const node = Object.assign(document.createElement(tag), props);
  kids.forEach((k) => node.append(k));
  return node;
};

// ---------- Login dialog ----------
let dialog;
function buildDialog() {
  const input = el('input', { type: 'password', id: 'admin-password', autocomplete: 'current-password', required: true, maxLength: 200 });
  const error = el('p', { className: 'form-error', role: 'alert' });
  const submit = el('button', { type: 'submit', className: 'btn btn-primary' }, 'Sign in');
  const cancel = el('button', { type: 'button', className: 'btn btn-ghost' }, 'Cancel');
  const form = el('form', { className: 'login-form', method: 'dialog' },
    el('h2', { id: 'login-title' }, 'Admin sign in'),
    el('p', { className: 'login-lead' }, 'For maintenance only. Guests do not need to sign in.'),
    el('label', { htmlFor: 'admin-password' }, 'Password'), input, error,
    el('div', { className: 'login-actions' }, cancel, submit));
  dialog = el('dialog', { className: 'login-dialog' }, form);
  dialog.setAttribute('aria-labelledby', 'login-title');
  document.body.appendChild(dialog);

  cancel.addEventListener('click', () => dialog.close());
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    error.textContent = '';
    submit.disabled = true;
    try {
      await login(input.value);
      input.value = '';
      dialog.close();
      if (!document.body.classList.contains('app')) location.href = 'app.html';
    } catch (err) {
      error.textContent = err.message === 'Failed to fetch' ? 'Cannot reach the server.' : err.message;
    } finally {
      submit.disabled = false;
    }
  });
}

export function openLogin() {
  if (!dialog) buildDialog();
  dialog.showModal();
  dialog.querySelector('input').focus();
}

// ---------- Header (top right) ----------
function renderHeader(slot) {
  slot.replaceChildren();
  if (state.admin) {
    const out = el('button', { type: 'button', className: 'btn btn-secondary btn-sm header-btn' }, createIcon('logout', { size: 18 }), 'Sign out');
    out.addEventListener('click', async () => { await logout(); location.reload(); });
    slot.append(el('span', { className: 'admin-badge' }, createIcon('lock', { size: 14 }), 'Admin'), out);
  } else {
    const btn = el('button', { type: 'button', className: 'btn btn-secondary btn-sm header-btn', id: 'admin-login-btn' }, createIcon('user', { size: 18 }), 'Admin login');
    btn.addEventListener('click', openLogin);
    slot.append(btn);
  }
}

export async function initHeader() {
  const slot = document.getElementById('header-actions');
  if (!slot) return;
  renderHeader(slot);
  await bootstrap();
  renderHeader(slot);
  document.body.classList.toggle('is-admin', state.admin);
  window.addEventListener('animap:data', () => {
    renderHeader(slot);
    document.body.classList.toggle('is-admin', state.admin);
  });
}

// ---------- Room editor (admin only, inside the 2D tab) ----------
// getRoom(id) -> the live room object; onChange() -> redraw after saving.
export function initRoomEditor({ svgRoot, getRoom }) {
  const panel = document.getElementById('room-editor');
  const toggle = document.getElementById('edit-mode-btn');
  if (!panel || !toggle) return;

  let editing = false;
  let selectedId = null;

  const name = panel.querySelector('#editor-name');
  const unavailable = panel.querySelector('#editor-unavailable');
  const title = panel.querySelector('#editor-title');
  const msg = panel.querySelector('#editor-message');

  function show(id) {
    const room = getRoom(id);
    if (!room) return;
    selectedId = id;
    title.textContent = room.defaultName;
    name.value = room.name;
    unavailable.checked = !!room.unavailable;
    msg.textContent = '';
    panel.hidden = false;
    svgRoot.querySelectorAll('.room.selected').forEach((n) => n.classList.remove('selected'));
    const node = svgRoot.querySelector(`.room[data-room-id="${id}"]`);
    if (node) node.classList.add('selected');
  }

  toggle.addEventListener('click', () => {
    editing = !editing;
    toggle.setAttribute('aria-pressed', String(editing));
    svgRoot.classList.toggle('editing', editing);
    if (!editing) panel.hidden = true;
  });

  svgRoot.addEventListener('click', (event) => {
    if (!editing || !state.admin) return;
    const node = event.target.closest('.room[data-room-id]');
    if (node) show(node.dataset.roomId);
  });
  window.addEventListener('animap:floor-drawn', () => {
    if (editing && selectedId) {
      const node = svgRoot.querySelector(`.room[data-room-id="${selectedId}"]`);
      if (node) node.classList.add('selected');
    }
  });

  async function run(action, okText) {
    msg.dataset.state = 'ok';
    msg.textContent = 'Saving…';
    try {
      await action();
      msg.textContent = okText;
      show(selectedId);
      msg.textContent = okText;
    } catch (err) {
      msg.dataset.state = 'error';
      msg.textContent = err.message;
    }
  }

  panel.querySelector('#editor-save').addEventListener('click', () =>
    run(() => saveRoom(selectedId, { name: name.value, unavailable: unavailable.checked }), 'Saved.'));
  panel.querySelector('#editor-reset').addEventListener('click', () => run(() => resetRoom(selectedId), 'Reset to the original.'));
  panel.querySelector('#editor-close').addEventListener('click', () => { panel.hidden = true; });
}