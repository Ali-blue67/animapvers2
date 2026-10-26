import { floorLevels, buildCampusGraph, getAllRooms, getFloorsById } from './campus-data.js';
import { createIcon } from './icons.js';
import { renderFloor, computeFloorBounds } from './floor-renderer.js';
import { enablePanZoom } from './pan-zoom.js';
import { findShortestPath, runDijkstra, reconstructPath, splitPathIntoLegs } from './pathfinding.js';

const graph = buildCampusGraph();
const allRooms = getAllRooms();
const floorsById = getFloorsById();

const $ = (id) => document.getElementById(id);
const svgRoot = $('floor-plan-svg');
const mapFrame = $('map-frame');
const mapTools = $('map-tools');
const floorSwitcherEl = $('floor-switcher');
const floorUpBtn = $('floor-up-btn');
const floorDownBtn = $('floor-down-btn');
const fromInput = $('from-input');
const toInput = $('to-input');
const findRouteBtn = $('find-route-btn');
const replayBtn = $('replay-btn');
const resetBtn = $('reset-btn');
const messageEl = $('route-message');
const legBanner = $('leg-banner');
const replayFloorsEl = $('replay-floors');
const verticalPrefEl = $('vertical-pref');

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

let fromRoom = null;
let toRoom = null;
let currentLegs = null;
let activeLegIndex = 0;
let activeFloorId = floorLevels[0].id;
let panZoom = null; // controller for the floor currently showing pan/zoom
let verticalPreference = 'none'; // 'none' | 'stairs' | 'elevator'

// ---------- Stairs / elevator preference ----------
// The option you didn't pick gets a heavy penalty rather than being
// banned, so a route still exists even if one of the two is missing.
function edgeWeight(edge) {
  if (edge.kind === 'stairs' && verticalPreference === 'elevator') return edge.weight * 8;
  if (edge.kind === 'elevator' && verticalPreference === 'stairs') return edge.weight * 8;
  return edge.weight;
}

function shortestPath(startId, endId) {
  return findShortestPath(graph, startId, endId, edgeWeight);
}

// Whichever room matching `predicate` is closest on foot to startId.
function findNearestRoom(startId, predicate) {
  const { distances, previous } = runDijkstra(graph, startId, edgeWeight);
  let best = null;
  let bestDistance = Infinity;

  allRooms.forEach((room) => {
    if (room.id === startId || !predicate(room)) return;
    const d = distances[room.id];
    if (d !== undefined && d < bestDistance) {
      bestDistance = d;
      best = room;
    }
  });

  return best ? { room: best, path: reconstructPath(previous, startId, best.id) } : null;
}

// ---------- Floor switcher ----------
floorLevels.forEach((level) => {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = level.label;
  button.dataset.floorId = level.id;
  button.setAttribute('aria-pressed', 'false');
  button.addEventListener('click', () => {
    setActiveFloor(level.id);
    clearActiveRoute();
  });
  floorSwitcherEl.appendChild(button);
});

function setActiveFloor(floorId) {
  activeFloorId = floorId;
  const floor = floorsById[floorId];

  if (panZoom) {
    panZoom.destroy();
    panZoom = null;
  }

  const bounds = renderFloor(svgRoot, floor, graph);
  svgRoot.setAttribute('aria-label', `Floor plan: ${floor.label}`);

  // Only Upper Ground is flagged panZoom in campus-data.js; the other
  // floors keep the simple auto-fit view.
  if (floor.panZoom) {
    const home = floor.homeFocus ? computeFloorBounds(floor.homeFocus) : bounds;
    panZoom = enablePanZoom(svgRoot, home, bounds);
  }
  mapTools.hidden = !floor.panZoom;

  floorSwitcherEl.querySelectorAll('button').forEach((btn) => {
    btn.setAttribute('aria-pressed', String(btn.dataset.floorId === floorId));
  });

  const idx = floorLevels.findIndex((l) => l.id === floorId);
  floorUpBtn.disabled = !(idx >= 0 && idx < floorLevels.length - 1);
  floorDownBtn.disabled = !(idx > 0);
}

function clearActiveRoute() {
  currentLegs = null;
  activeLegIndex = 0;
  replayBtn.disabled = true;
  legBanner.classList.remove('visible');
  replayFloorsEl.classList.remove('visible');
  showMessage('', false);
}

function stepFloor(direction) {
  const idx = floorLevels.findIndex((l) => l.id === activeFloorId);
  const next = floorLevels[idx + direction];
  if (!next) return;
  setActiveFloor(next.id);
  clearActiveRoute();
}

floorUpBtn.addEventListener('click', () => stepFloor(1));
floorDownBtn.addEventListener('click', () => stepFloor(-1));

$('zoom-in-btn').addEventListener('click', () => panZoom && panZoom.zoomIn());
$('zoom-out-btn').addEventListener('click', () => panZoom && panZoom.zoomOut());
$('zoom-reset-btn').addEventListener('click', () => panZoom && panZoom.reset());

verticalPrefEl.querySelectorAll('.pref-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    if (btn.getAttribute('aria-pressed') === 'true') return;
    verticalPreference = btn.dataset.pref;
    verticalPrefEl.querySelectorAll('.pref-btn').forEach((b) => {
      b.setAttribute('aria-pressed', String(b === btn));
    });
    // Re-run the current search so the change applies immediately.
    if (fromRoom && toRoom) handleFindRoute();
  });
});

// ---------- Search ----------
function isRestroom(room) {
  const n = room.name.toLowerCase();
  return n.includes('restroom') || n.includes('bathroom');
}
const isMaleRestroom = (room) => isRestroom(room) && /male/i.test(room.name) && !/female/i.test(room.name);
const isFemaleRestroom = (room) => isRestroom(room) && /female/i.test(room.name);

function mentionsRestroom(q) {
  if (/\bcr\b/.test(q)) return true; // "CR": common local shorthand for comfort room
  return ['bathroom', 'restroom', 'toilet', 'comfort room'].some((kw) => q.includes(kw));
}

// A restroom-looking search offers "Nearest restroom", worked out from
// whatever is chosen as the current location.
function getNearestOptions(query) {
  const q = query.trim().toLowerCase();
  if (!mentionsRestroom(q)) return [];
  if (q.includes('female')) return [{ special: true, label: 'Nearest female restroom', predicate: isFemaleRestroom }];
  if (q.includes('male')) return [{ special: true, label: 'Nearest male restroom', predicate: isMaleRestroom }];
  return [{ special: true, label: 'Nearest restroom', predicate: isRestroom }];
}

function getMatches(query) {
  const q = query.trim().toLowerCase();
  if (!q) return allRooms;
  return allRooms.filter((room) => `${room.name} ${room.code}`.toLowerCase().includes(q));
}

const roomName = (room) => (room.code ? `${room.name} (${room.code})` : room.name);
const roomLabel = (room) => `${roomName(room)} \u00b7 ${room.floorLabel}`;

function setupSearchField({ input, list, button, onPick, onClear, allowNearest }) {
  let options = []; // actionable options currently listed
  let activeIndex = -1;

  function setActive(index) {
    activeIndex = index;
    options.forEach((opt, i) => opt.el.setAttribute('aria-selected', String(i === index)));
    if (index >= 0) {
      input.setAttribute('aria-activedescendant', options[index].el.id);
      options[index].el.scrollIntoView({ block: 'nearest' });
    } else {
      input.removeAttribute('aria-activedescendant');
    }
  }

  function close() {
    list.classList.remove('open');
    input.setAttribute('aria-expanded', 'false');
    setActive(-1);
  }

  function pick(item) {
    input.value = item.special ? item.label : roomLabel(item);
    close();
    onPick(item);
  }

  function addOption(el, item) {
    el.setAttribute('role', 'option');
    el.id = `${list.id}-opt-${options.length}`;
    el.setAttribute('aria-selected', 'false');
    el.addEventListener('click', () => pick(item));
    options.push({ el, item });
    list.appendChild(el);
  }

  function addNote(text, className) {
    const li = document.createElement('li');
    li.className = className;
    li.setAttribute('role', 'option');
    li.setAttribute('aria-disabled', 'true');
    li.textContent = text;
    list.appendChild(li);
  }

  function render() {
    list.innerHTML = '';
    options = [];
    activeIndex = -1;
    input.removeAttribute('aria-activedescendant');

    const nearest = allowNearest ? getNearestOptions(input.value) : [];
    const matches = getMatches(input.value);

    nearest.forEach((opt) => {
      if (fromRoom) {
        const li = document.createElement('li');
        li.className = 'nearest-option';
        li.append(createIcon('map-pin', { size: 16 }), `${opt.label} from ${fromRoom.name}`);
        addOption(li, opt);
      } else {
        addNote(`${opt.label}: set "Current location" first`, 'nearest-hint');
      }
    });

    matches.slice(0, 40).forEach((room) => {
      const li = document.createElement('li');
      const name = document.createElement('span');
      name.textContent = roomName(room);
      const meta = document.createElement('span');
      meta.className = 'opt-meta';
      meta.textContent = room.floorLabel;
      li.append(name, meta);
      addOption(li, room);
    });

    if (!matches.length && !nearest.length) addNote('No rooms match that search', 'nearest-hint');

    list.classList.add('open');
    input.setAttribute('aria-expanded', 'true');
  }

  // Autofill with the best match for whatever is typed.
  function selectTopMatch() {
    if (!input.value.trim()) {
      input.focus();
      render();
      return;
    }
    const nearest = allowNearest ? getNearestOptions(input.value) : [];
    if (nearest.length && fromRoom) return pick(nearest[0]);
    const matches = getMatches(input.value);
    if (matches.length) pick(matches[0]);
  }

  input.addEventListener('input', () => {
    onClear();
    render();
  });
  input.addEventListener('focus', render);
  input.addEventListener('keydown', (event) => {
    const open = list.classList.contains('open');
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) render();
      if (!options.length) return;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive((activeIndex + step + options.length) % options.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (open && activeIndex >= 0) pick(options[activeIndex].item);
      else handleFindRoute();
    } else if (event.key === 'Escape' && open) {
      close();
    }
  });

  document.addEventListener('click', (event) => {
    if (!input.contains(event.target) && !list.contains(event.target) && !(button && button.contains(event.target))) {
      close();
    }
  });

  if (button) button.addEventListener('click', selectTopMatch);
}

setupSearchField({
  input: fromInput,
  list: $('from-suggestions'),
  button: $('from-search-btn'),
  onPick: (room) => { fromRoom = room; },
  onClear: () => { fromRoom = null; },
  allowNearest: false,
});

setupSearchField({
  input: toInput,
  list: $('to-suggestions'),
  button: $('to-search-btn'),
  onPick: (room) => { toRoom = room; },
  onClear: () => { toRoom = null; },
  allowNearest: true,
});

// ---------- Drawing and animating a route ----------
function buildPathString(nodeIds) {
  return nodeIds
    .map((id, index) => `${index === 0 ? 'M' : 'L'} ${graph.nodes[id].x} ${graph.nodes[id].y}`)
    .join(' ');
}

function setHighlightedRooms(fromId, toId) {
  svgRoot.querySelectorAll('.room.highlight').forEach((el) => el.classList.remove('highlight'));
  [fromId, toId].forEach((id) => {
    const el = svgRoot.querySelector(`.room[data-room-id="${id}"]`);
    if (el) el.classList.add('highlight');
  });
}

function drawRoute(nodeIds) {
  const start = graph.nodes[nodeIds[0]];
  const end = graph.nodes[nodeIds[nodeIds.length - 1]];

  $('route-line').setAttribute('d', buildPathString(nodeIds));
  $('start-marker').setAttribute('cx', start.x);
  $('start-marker').setAttribute('cy', start.y);
  $('end-marker').setAttribute('cx', end.x);
  $('end-marker').setAttribute('cy', end.y);

  setHighlightedRooms(nodeIds[0], nodeIds[nodeIds.length - 1]);
  fitRouteInView(nodeIds);
  playRouteAnimation();
}

// On a pan/zoom floor, frame the route so it's never off-screen.
function fitRouteInView(nodeIds) {
  if (!panZoom) return;
  const xs = nodeIds.map((id) => graph.nodes[id].x);
  const ys = nodeIds.map((id) => graph.nodes[id].y);
  const pad = 130;
  const minX = Math.min(...xs) - pad;
  const minY = Math.min(...ys) - pad;
  panZoom.fitTo({
    x: minX,
    y: minY,
    width: Math.max(Math.max(...xs) + pad - minX, 520),
    height: Math.max(Math.max(...ys) + pad - minY, 300),
  });
}

function playRouteAnimation() {
  const line = $('route-line');
  if (!line) return;
  const length = line.getTotalLength();

  line.style.transition = 'none';
  line.style.strokeDasharray = `${length}`;
  line.style.strokeDashoffset = `${length}`;
  line.getBoundingClientRect(); // commit the hidden state before animating

  // Longer routes take a little longer to draw.
  const seconds = Math.min(2.8, Math.max(1.2, length / 900));
  line.style.transition = reduceMotion.matches
    ? 'none'
    : `stroke-dashoffset ${seconds}s cubic-bezier(0.2, 0.7, 0.2, 1)`;
  line.style.strokeDashoffset = '0';

  $('start-marker').classList.add('visible');
  $('end-marker').classList.add('visible');
}

// ---------- Finding a route ----------
function showMessage(text, isError) {
  messageEl.textContent = text;
  messageEl.dataset.state = isError ? 'error' : 'ok';
}

function handleFindRoute() {
  if (!fromRoom || !toRoom) {
    showMessage('Pick a room from the list for both fields.', true);
    return;
  }

  let destination = toRoom;
  let path;

  if (toRoom.special) {
    const result = findNearestRoom(fromRoom.id, toRoom.predicate);
    if (!result) {
      showMessage('No matching restroom could be found from here.', true);
      return;
    }
    destination = result.room;
    path = result.path;
  } else {
    if (fromRoom.id === toRoom.id) {
      showMessage('You are already there.', false);
      return;
    }
    path = shortestPath(fromRoom.id, toRoom.id);
  }

  if (!path) {
    showMessage('No route could be found between these rooms.', true);
    return;
  }

  currentLegs = splitPathIntoLegs(path, graph.nodeFloor);

  const crossesFloors = currentLegs.length > 1;
  showMessage(
    crossesFloors
      ? `${fromRoom.name} (${fromRoom.floorLabel}) \u2192 ${destination.name} (${destination.floorLabel})`
      : `${fromRoom.name} \u2192 ${destination.name}`,
    false
  );

  goToLeg(0);
  mapFrame.scrollIntoView({ block: 'nearest', behavior: reduceMotion.matches ? 'auto' : 'smooth' });
}

function goToLeg(index) {
  activeLegIndex = index;
  const leg = currentLegs[index];
  setActiveFloor(leg.floorId);
  drawRoute(leg.nodeIds);
  replayBtn.disabled = false;
  updateLegBanner();
  updateReplayFloors();
}

function connectorKind(nodeId) {
  return nodeId.includes('elevator') ? 'elevator' : 'stairs';
}

function updateLegBanner() {
  const isLastLeg = !currentLegs || activeLegIndex === currentLegs.length - 1;
  if (!currentLegs || currentLegs.length <= 1 || isLastLeg) {
    legBanner.classList.remove('visible');
    return;
  }

  const nextFloor = floorsById[currentLegs[activeLegIndex + 1].floorId];
  const lastNode = currentLegs[activeLegIndex].nodeIds.slice(-1)[0];

  const text = document.createElement('span');
  text.textContent = `Take the ${connectorKind(lastNode)} to ${nextFloor.label}.`;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn btn-primary btn-sm';
  button.append(`Continue to ${nextFloor.label}`, createIcon('arrow-right', { size: 18 }));
  button.addEventListener('click', () => goToLeg(activeLegIndex + 1));

  legBanner.replaceChildren(text, button);
  legBanner.classList.add('visible');
}

// For a route that crosses floors: one button per floor, so any floor's
// part of the animation can be replayed directly.
function updateReplayFloors() {
  if (!currentLegs || currentLegs.length <= 1) {
    replayFloorsEl.classList.remove('visible');
    return;
  }

  const label = document.createElement('span');
  label.textContent = 'Replay by floor';

  const group = document.createElement('div');
  group.className = 'segmented segmented-scroll';
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', 'Replay by floor');

  currentLegs.forEach((leg, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = floorsById[leg.floorId].label;
    button.setAttribute('aria-pressed', String(index === activeLegIndex));
    button.addEventListener('click', () => goToLeg(index));
    group.appendChild(button);
  });

  replayFloorsEl.replaceChildren(label, group);
  replayFloorsEl.classList.add('visible');
}

function handleReset() {
  fromInput.value = '';
  toInput.value = '';
  fromRoom = null;
  toRoom = null;
  clearActiveRoute();
  setActiveFloor(activeFloorId);
}

findRouteBtn.addEventListener('click', handleFindRoute);
replayBtn.addEventListener('click', () => {
  if (currentLegs) playRouteAnimation();
});
resetBtn.addEventListener('click', handleReset);

setActiveFloor(activeFloorId);