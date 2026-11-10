// Admin sign-in (shared by the welcome page and the app) and the room editor.
import { state, bootstrap, login, logout, saveRoom, resetRoom, addLegend, removeLegend } from './api.js';
import { getLegends, legendOf, legendFill } from './campus-data.js';
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
      const s = err.status;
      if (err.message === 'Failed to fetch') error.textContent = 'Cannot reach the server. Open the site from your deployed address (or wrangler dev), not a plain file or Live Server.';
      else if (s === 404 || s === 405) error.textContent = 'The admin server (Worker) is not running at this address. Deploy it with wrangler, or open the wrangler dev address.';
      else if (s === 500) error.textContent = 'Server error: the database is probably not set up yet. Run the D1 schema step and the secrets step, then try again.';
      else error.textContent = err.message;
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
  const desc = panel.querySelector('#editor-desc');
  const unavailable = panel.querySelector('#editor-unavailable');
  const title = panel.querySelector('#editor-title');
  const msg = panel.querySelector('#editor-message');
  const fields = panel.querySelector('#editor-fields');
  const warning = document.getElementById('edit-warning');
  const warningOk = document.getElementById('edit-warning-ok');
  if (warningOk) warningOk.addEventListener('click', () => { warning.hidden = true; toggle.focus(); });

  const chips = panel.querySelector('#editor-legends');
  const legendWrap = panel.querySelector('#editor-legend-wrap');
  const current = panel.querySelector('#editor-current');
  let chosenLegend = ''; // '' = the room's normal colour

  function drawChips(room) {
    const normal = legendOf({ cat: room.cat }).id; // the colour this room has without any admin choice
    chips.replaceChildren();
    getLegends().forEach((l) => {
      const on = l.id === chosenLegend || (!chosenLegend && l.id === normal);
      const chip = el('button', { type: 'button', className: `legend-chip${on ? ' on' : ''}` });
      chip.setAttribute('role', 'radio');
      chip.setAttribute('aria-checked', String(on));
      const sw = el('span', { className: l.custom ? 'swatch' : `swatch cat-${l.id}` });
      if (l.custom) { sw.style.borderColor = l.color; sw.style.background = legendFill(l.color); }
      chip.append(sw, document.createTextNode(l.label));
      chip.addEventListener('click', () => { chosenLegend = l.id === normal ? '' : l.id; drawChips(room); });
      if (l.custom) {
        const del = el('span', { className: 'chip-del', title: `Delete the "${l.label}" legend`, textContent: '×' });
        del.addEventListener('click', async (ev) => {
          ev.stopPropagation();
          if (!window.confirm(`Delete the legend "${l.label}"? Rooms using it go back to their normal colour.`)) return;
          try { if (chosenLegend === l.id) chosenLegend = ''; await removeLegend(l.id); show(selectedId); } catch (err) { msg.dataset.state = 'error'; msg.textContent = err.message; }
        });
        chip.append(del);
      }
      chips.appendChild(chip);
    });
  }

  function show(id) {
    const room = getRoom(id);
    if (!room) return;
    selectedId = id;
    const lg = legendOf(room);
    title.textContent = room.name;
    current.textContent = `${room.floorLabel ? room.floorLabel + ' · ' : ''}${room.code ? room.code + ' · ' : ''}${lg.label}${room.unavailable ? ' · Unavailable' : ''}`;
    name.value = room.name;
    desc.value = room.code || '';
    desc.placeholder = room.defaultCode || 'Room number';
    unavailable.checked = !!room.unavailable;
    const isBox = room.width !== undefined; // icon-only markers have no colour to change
    legendWrap.hidden = !isBox;
    chosenLegend = room.legendId || '';
    if (isBox) drawChips(room);
    fields.disabled = false;
    panel.hidden = false;
    svgRoot.querySelectorAll('.room.selected').forEach((n) => n.classList.remove('selected'));
    const node = svgRoot.querySelector(`.room[data-room-id="${id}"]`);
    if (node) node.classList.add('selected');
  }

  panel.querySelector('#new-legend-add').addEventListener('click', async () => {
    const label = panel.querySelector('#new-legend-name');
    const color = panel.querySelector('#new-legend-color');
    if (!label.value.trim()) { msg.dataset.state = 'error'; msg.textContent = 'Give the new legend a name first.'; return; }
    msg.dataset.state = 'ok';
    msg.textContent = 'Adding legend…';
    try {
      const id = await addLegend(label.value.trim(), color.value);
      chosenLegend = id; // use it for this room straight away
      label.value = '';
      show(selectedId);
      chosenLegend = id;
      drawChips(getRoom(selectedId));
      msg.textContent = 'Legend added and picked. Press Save to colour this room with it.';
    } catch (err) {
      msg.dataset.state = 'error';
      msg.textContent = err.message;
    }
  });

  toggle.addEventListener('click', () => {
    editing = !editing;
    toggle.setAttribute('aria-pressed', String(editing));
    svgRoot.classList.toggle('editing', editing);
    const label = document.getElementById('edit-mode-label');
    if (label) label.textContent = editing ? 'Done editing' : 'Edit rooms';
    const hint = document.getElementById('edit-hint');
    if (hint) hint.hidden = !editing;
    if (editing) {
      selectedId = null;
      title.textContent = 'Click a room on the map';
      current.textContent = '';
      fields.disabled = true;
      msg.textContent = '';
      panel.hidden = false;
      if (warning) { warning.hidden = false; warningOk.focus(); }
    } else {
      panel.hidden = true;
      if (warning) warning.hidden = true;
      svgRoot.querySelectorAll('.room.selected').forEach((n) => n.classList.remove('selected'));
    }
  });

  // The map captures the pointer while you press on it, which makes the browser report the click as
  // happening on the whole map. So find the room under the pointer ourselves, and ignore drags.
  let downAt = null;
  svgRoot.addEventListener('pointerdown', (e) => { downAt = { x: e.clientX, y: e.clientY }; }, true);
  svgRoot.addEventListener('click', (event) => {
    if (!editing || !state.admin) return;
    if (downAt && Math.hypot(event.clientX - downAt.x, event.clientY - downAt.y) > 6) return; // that was a drag
    let node = event.target.closest && event.target.closest('.room[data-room-id]');
    if (!node) {
      const under = document.elementFromPoint(event.clientX, event.clientY);
      node = under && under.closest ? under.closest('.room[data-room-id]') : null;
    }
    if (node && svgRoot.contains(node)) show(node.dataset.roomId);
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
    run(() => saveRoom(selectedId, { name: name.value, description: desc.value, unavailable: unavailable.checked, legend: chosenLegend }), 'Saved.'));
  panel.querySelector('#editor-reset').addEventListener('click', () => run(() => resetRoom(selectedId), 'Reset to the original.'));
  panel.querySelector('#editor-close').addEventListener('click', () => { panel.hidden = true; });
}