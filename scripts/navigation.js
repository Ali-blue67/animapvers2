import { floorLevels, buildCampusGraph, getAllRooms, getFloorsById, GROUND_ZONES, groundZoneOf, getLegends, legendFill } from './campus-data.js';
import { createIcon } from './icons.js';
import { renderFloor, computeFloorBounds, setEndArrow } from './floor-renderer.js';
import { enablePanZoom } from './pan-zoom.js';
import { findShortestPath, runDijkstra, reconstructPath, splitPathIntoLegs } from './pathfinding.js';
import { initRoomEditor } from './admin.js';
import { state } from './api.js';

const graph = buildCampusGraph();
let allRooms = getAllRooms();
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
const pwdDialog = $('pwd-dialog');

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

let fromRoom = null;
let toRoom = null;
let currentLegs = null;
let activeLegIndex = 0;
let legCollapsed = false; // the steps card can be folded up to give the map more room
let routeLocked = false; // the last step has been shown: the next person has to press Reset first
const HOME_FLOOR = 'ground'; // Upper Ground is where everyone starts
let activeFloorId = HOME_FLOOR;
let panZoom = null; // controller for the floor currently showing pan/zoom
let verticalPreference = 'stairs'; // 'stairs' | 'elevator' | 'pwd'

const floorIndex = (floorId) => floorLevels.findIndex((l) => l.id === floorId);

// ---------- Stairs / elevator / PWD preference ----------
// The option you didn't pick gets a heavy penalty rather than being
// banned, so a route still exists even if only the other one is available
// (for example the HS Cafeteria 2nd floor, which only has stairs).
function edgeWeight(edge) {
  if (verticalPreference !== 'pwd' && edge.pwdOnly) return edge.weight * 1000; // paths made for wheelchair users
  if (verticalPreference === 'pwd' && edge.pwd === false) return edge.weight * 1000;
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
    if (room.id === startId || room.unavailable || !predicate(room)) return;
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
    if (!routeLocked) clearActiveRoute();
    setActiveFloor(level.id);
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
  svgRoot.classList.toggle('pwd-mode', verticalPreference === 'pwd');

  // Only Upper Ground is flagged panZoom in campus-data.js; the other
  // floors keep the simple auto-fit view.
  if (floor.panZoom) {
    // White margin all round, so at the furthest zoom-out the whole plan floats inside empty space.
    const margin = Math.max(bounds.width, bounds.height) * 0.06;
    const world = { x: bounds.x - margin, y: bounds.y - margin, width: bounds.width + margin * 2, height: bounds.height + margin * 2 };
    const home = floor.homeFocus ? computeFloorBounds(floor.homeFocus) : world;
    panZoom = enablePanZoom(svgRoot, home, world);
  }
  mapTools.hidden = !floor.panZoom;

  floorSwitcherEl.querySelectorAll('button').forEach((btn) => {
    btn.setAttribute('aria-pressed', String(btn.dataset.floorId === floorId));
  });

  const idx = floorIndex(floorId);
  floorUpBtn.disabled = !(idx >= 0 && idx < floorLevels.length - 1);
  floorDownBtn.disabled = !(idx > 0);
  window.dispatchEvent(new CustomEvent('animap:floor-drawn'));
}

// Keeps the map clear of the floating steps card: on a wide screen the card takes a column on the left,
// otherwise (or while it is folded up) the map simply starts below it.
const wideQuery = window.matchMedia('(min-width: 900px)');
function syncOverlay() {
  const show = legBanner.classList.contains('visible');
  const side = show && wideQuery.matches && !legCollapsed;
  mapFrame.classList.toggle('has-overlay', show);
  mapFrame.classList.toggle('overlay-side', side);
  mapFrame.style.setProperty('--overlay-h', show && !side ? `${legBanner.offsetHeight + 20}px` : '0px');
  mapFrame.style.setProperty('--overlay-w', side ? `${legBanner.offsetWidth + 20}px` : '0px');
}
window.addEventListener('resize', () => { if (currentLegs) syncOverlay(); });

function clearActiveRoute() {
  currentLegs = null;
  setRouteLock(false);
  activeLegIndex = 0;
  replayBtn.disabled = true;
  legBanner.classList.remove('visible');
  syncOverlay();
  legBanner.replaceChildren();
  replayFloorsEl.classList.remove('visible');
  floorSwitcherEl.querySelectorAll('.target-floor').forEach((b) => b.classList.remove('target-floor'));
  showMessage('', false);
}

function stepFloor(direction) {
  const next = floorLevels[floorIndex(activeFloorId) + direction];
  if (!next) return;
  if (!routeLocked) clearActiveRoute();
  setActiveFloor(next.id);
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
    svgRoot.classList.toggle('pwd-mode', verticalPreference === 'pwd');
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

// Pinned places (Gate 2.5) always come first, so they are the first
// option guests see when they open the list.
function getMatches(query) {
  const q = query.trim().toLowerCase();
  const list = q ? allRooms.filter((room) => `${room.name} ${room.code}`.toLowerCase().includes(q)) : allRooms.slice();
  return list.sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned));
}

const roomName = (room) => (room.code ? `${room.name} (${room.code})` : room.name);
const roomLabel = (room) => `${roomName(room)} · ${room.floorLabel}`;

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
      if (room.pinned) li.className = 'pinned-option';
      if (room.unavailable) li.classList.add('is-unavailable');
      const name = document.createElement('span');
      name.textContent = roomName(room);
      const meta = document.createElement('span');
      meta.className = 'opt-meta';
      meta.textContent = room.unavailable ? `Unavailable · ${room.floorLabel}` : room.pinned ? `Pinned · ${room.floorLabel}` : room.floorLabel;
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

// 'arrow-up' / 'arrow-down' when this leg ends at a stairs/elevator/ramp, otherwise null.
function endArrowFor(index) {
  if (!currentLegs || index >= currentLegs.length - 1) return null;
  if (currentLegs[index + 1].floorId === currentLegs[index].floorId) return 'arrow-narrow-right'; // continues on this floor (next zone)
  const goingUp = floorIndex(currentLegs[index + 1].floorId) > floorIndex(currentLegs[index].floorId);
  return goingUp ? 'arrow-up' : 'arrow-down';
}

function drawRoute(nodeIds) {
  const start = graph.nodes[nodeIds[0]];
  const end = graph.nodes[nodeIds[nodeIds.length - 1]];

  $('route-line').setAttribute('d', buildPathString(nodeIds));
  $('start-marker').setAttribute('cx', start.x);
  $('start-marker').setAttribute('cy', start.y);
  $('end-marker').setAttribute('cx', end.x);
  $('end-marker').setAttribute('cy', end.y);

  // Up/down arrow replaces the red dot where the route leaves this floor.
  const arrow = endArrowFor(activeLegIndex);
  let angle = 0;
  if (arrow === 'arrow-narrow-right' && nodeIds.length > 1) {
    const before = graph.nodes[nodeIds[nodeIds.length - 2]];
    angle = (Math.atan2(end.y - before.y, end.x - before.x) * 180) / Math.PI;
  }
  setEndArrow(svgRoot, arrow, end.x, end.y, angle);

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

  // Drawn slowly and calmly so it is easy to follow; longer routes take a little longer.
  const seconds = Math.max(6, Math.min(2.8, Math.max(1.2, length / 900)) * 3);
  line.style.transition = reduceMotion.matches
    ? 'none'
    : `stroke-dashoffset ${seconds}s cubic-bezier(0.2, 0.7, 0.2, 1)`;
  line.style.strokeDashoffset = '0';

  $('start-marker').classList.add('visible');
  $('end-marker').classList.add('visible');

  // The arrow pops in as the line reaches the stairs / elevator.
  const arrow = svgRoot.querySelector('#end-arrow.visible');
  if (arrow) {
    arrow.classList.remove('visible');
    arrow.style.transitionDelay = reduceMotion.matches ? '0s' : `${seconds * 0.85}s`;
    arrow.getBoundingClientRect();
    arrow.classList.add('visible');
  }
}

// ---------- Finding a route ----------
function showMessage(text, isError) {
  messageEl.textContent = text;
  messageEl.dataset.state = isError ? 'error' : 'ok';
}

// Steps that use stairs while "PWD" is selected (e.g. HS Cafeteria 2nd floor).
function stairsUsedInPwdRoute(path) {
  const floors = [];
  for (let i = 0; i < path.length - 1; i++) {
    const edge = (graph.edges[path[i]] || []).find((e) => e.to === path[i + 1] && e.kind === 'stairs');
    if (edge) floors.push(floorsById[graph.nodeFloor[path[i + 1]]].label);
  }
  return floors;
}

function showPwdWarning(floorLabels) {
  const unique = [...new Set(floorLabels)];
  $('pwd-dialog-text').textContent = `The floor going above (${unique.join(', ')}) does not have a ramp or an elevator in this area, only stairs. The route is still shown so you know where it leads.`;
  if (typeof pwdDialog.showModal === 'function') pwdDialog.showModal();
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
    if (toRoom.unavailable) {
      showMessage(`${toRoom.name} is currently unavailable.`, true);
      return;
    }
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

  currentLegs = splitGroundZones(skipElevatorFloors(splitPathIntoLegs(path, graph.nodeFloor)));
  currentLegs.destination = destination;
  currentLegs.origin = fromRoom;
  legCollapsed = false;

  const crossesFloors = currentLegs.length > 1;
  showMessage(
    crossesFloors
      ? `${fromRoom.name} (${fromRoom.floorLabel}) → ${destination.name} (${destination.floorLabel})`
      : `${fromRoom.name} → ${destination.name}`,
    false
  );

  goToLeg(0);
  mapFrame.scrollIntoView({ block: 'nearest', behavior: reduceMotion.matches ? 'auto' : 'smooth' });

  if (verticalPreference === 'pwd') {
    const stairFloors = stairsUsedInPwdRoute(path);
    if (stairFloors.length) showPwdWarning(stairFloors);
  }
}

// An elevator ride through floors you do not get off at (UG > 2nd > 3rd > 4th) becomes ONE step:
// the floors in between are dropped, so the route jumps straight to the floor you leave on.
function skipElevatorFloors(legs) {
  const isElevator = (id) => id.includes('elevator');
  const out = [];
  legs.forEach((leg, i) => {
    const inBetween = i > 0 && i < legs.length - 1 && leg.nodeIds.length === 1 && isElevator(leg.nodeIds[0]);
    if (!inBetween) out.push(leg);
  });
  return out;
}

// On the Upper Ground a route is shown one zone at a time (HS complex, the pathway, MTH, CTH),
// so it is readable without zooming. Each new zone starts on the node where the last one ended.
function splitGroundZones(legs) {
  const out = [];
  legs.forEach((leg) => {
    if (leg.floorId !== 'ground') { out.push(leg); return; }
    const zones = leg.nodeIds.map((id) => groundZoneOf(graph.nodes[id].x, graph.nodes[id].y));
    // Only routes that really go out to MTH / CTH are split. Anything inside the HS complex
    // (including a start at Gate 2.5) stays one plain step.
    if (!zones.includes('mth') && !zones.includes('cth')) { out.push(leg); return; }
    // A zone that lasts for a single point (a junction, a doorway) joins its neighbour instead of being a step.
    for (let i = 0; i < zones.length; i++) {
      const alone = (i === 0 || zones[i - 1] !== zones[i]) && (i === zones.length - 1 || zones[i + 1] !== zones[i]);
      if (alone && zones.length > 1) zones[i] = i > 0 ? zones[i - 1] : zones[i + 1];
    }
    const pieces = [];
    leg.nodeIds.forEach((id, i) => {
      let piece = pieces[pieces.length - 1];
      if (!piece || piece.zone !== zones[i]) {
        piece = { floorId: leg.floorId, zone: zones[i], nodeIds: piece ? [piece.nodeIds[piece.nodeIds.length - 1]] : [] };
        pieces.push(piece);
      }
      piece.nodeIds.push(id);
    });
    if (pieces.length > 1) pieces.forEach((p) => { p.zoneLabel = GROUND_ZONES[p.zone]; });
    out.push(...pieces);
  });
  return out;
}

const legLabel = (leg) => leg.zoneLabel || floorsById[leg.floorId].label;

function goToLeg(index) {
  activeLegIndex = index;
  const leg = currentLegs[index];
  updateLegBanner(); // first, so the map below is sized for the card before it is drawn
  setActiveFloor(leg.floorId);
  markTargetFloor();
  drawRoute(leg.nodeIds);
  if (index === currentLegs.length - 1) setRouteLock(true);
  replayBtn.disabled = false;
  updateReplayFloors();
}

// Highlights, in the floor selector, the floor to get off on at the end of this step.
function markTargetFloor() {
  const next = currentLegs && currentLegs[activeLegIndex + 1];
  floorSwitcherEl.querySelectorAll('button').forEach((btn) => {
    btn.classList.toggle('target-floor', !!next && next.floorId !== currentLegs[activeLegIndex].floorId && btn.dataset.floorId === next.floorId);
  });
}

function connectorKind(nodeId) {
  if (nodeId.includes('elevator')) return 'elevator';
  if (nodeId.includes('ramp')) return 'ramp';
  return 'stairs';
}

// One short sentence for each floor of the route.
function stepText(index) {
  const leg = currentLegs[index];
  if (index === currentLegs.length - 1) return `Walk to ${currentLegs.destination.name}`;
  const kind = connectorKind(leg.nodeIds[leg.nodeIds.length - 1]);
  const nextLeg = currentLegs[index + 1];
  if (nextLeg.floorId === leg.floorId) {
    const place = document.createElement('span');
    place.className = 'floor-target';
    place.textContent = nextLeg.zoneLabel;
    const note = document.createDocumentFragment();
    const lead = { path: 'Take the ', hs: 'Enter the ' }[nextLeg.zone] || 'Continue to ';
    note.append(lead, place);
    return note;
  }
  const nextFloor = floorsById[nextLeg.floorId];
  const dir = floorIndex(nextFloor.id) > floorIndex(leg.floorId) ? 'UP' : 'DOWN';
  const target = document.createElement('span');
  target.className = 'floor-target';
  target.textContent = nextFloor.label;
  const frag = document.createDocumentFragment();
  frag.append(`Take the ${kind} ${dir} to `, target);
  return frag;
}

// The steps card: every step of the route in one list. Finished steps stay (ticked), the current one is
// highlighted, and any step can be tapped to jump back to it.
function updateLegBanner() {
  if (!currentLegs) {
    legBanner.classList.remove('visible');
    syncOverlay();
    return;
  }
  const index = activeLegIndex;
  const total = currentLegs.length;
  const isLast = index === total - 1;

  const head = document.createElement('div');
  head.className = 'leg-head';
  const count = document.createElement('p');
  count.className = 'leg-step-count';
  count.textContent = total > 1 ? `Your route · Step ${index + 1} of ${total}` : 'Your route';
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'leg-toggle';
  toggle.setAttribute('aria-expanded', String(!legCollapsed));
  toggle.setAttribute('aria-label', legCollapsed ? 'Show all steps' : 'Show only the current step');
  toggle.title = toggle.getAttribute('aria-label');
  toggle.append(createIcon('chevron-down', { size: 18 }));
  toggle.addEventListener('click', () => {
    legCollapsed = !legCollapsed;
    updateLegBanner();
  });
  head.append(count, toggle);

  const list = document.createElement('ol');
  list.className = 'leg-steps';
  currentLegs.forEach((leg, i) => {
    const item = document.createElement('li');
    item.className = i < index ? 'done' : i === index ? 'current' : '';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'leg-step';
    if (i === index) button.setAttribute('aria-current', 'step');
    const mark = document.createElement('span');
    mark.className = 'step-mark';
    if (i < index) mark.append(createIcon('check', { size: 14 }));
    else mark.textContent = String(i + 1);
    const copy = document.createElement('span');
    copy.className = 'step-copy';
    const text = document.createElement('span');
    text.className = 'step-text';
    const arrow = i === index ? endArrowFor(i) : null;
    if (arrow) text.append(createIcon(arrow, { size: 16, className: 'step-arrow' }));
    text.append(stepText(i));
    const place = document.createElement('span');
    place.className = 'step-place';
    place.textContent = legLabel(leg);
    copy.append(text, place);
    button.append(mark, copy);
    button.addEventListener('click', () => goToLeg(i));
    item.appendChild(button);
    list.appendChild(item);
  });

  const parts = [head, list];
  if (!isLast) {
    const next = document.createElement('button');
    next.type = 'button';
    next.className = 'btn btn-primary leg-next';
    next.append('Continue', createIcon('arrow-right', { size: 18 }));
    next.addEventListener('click', () => goToLeg(index + 1));
    parts.push(next);
  } else {
    const done = document.createElement('p');
    done.className = 'leg-done';
    done.textContent = 'You have arrived. Press Reset to plan another route.';
    parts.push(done);
  }
  legBanner.classList.toggle('collapsed', legCollapsed);
  legBanner.replaceChildren(...parts);
  legBanner.classList.add('visible');
  const currentEl = list.querySelector('.current');
  if (currentEl && !legCollapsed) list.scrollTop = Math.max(0, currentEl.offsetTop - 8);
  syncOverlay();
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
    button.textContent = legLabel(leg);
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

// ---------- After the last step: the next person must press Reset ----------
const lockDialog = $('lock-dialog');
const directionsCard = document.querySelector('.directions');

function setRouteLock(on) {
  routeLocked = on;
  resetBtn.classList.toggle('emphasis', on);
  fromInput.readOnly = on;
  toInput.readOnly = on;
  directionsCard.classList.toggle('is-locked', on);
}

function nudgeReset() {
  if (lockDialog && typeof lockDialog.showModal === 'function' && !lockDialog.open) lockDialog.showModal();
  resetBtn.classList.remove('nudge');
  void resetBtn.offsetWidth; // restart the animation
  resetBtn.classList.add('nudge');
}

// Any attempt to change the rooms or preferences while locked gets the warning instead.
['pointerdown', 'click', 'focusin', 'keydown'].forEach((type) => {
  directionsCard.addEventListener(type, (event) => {
    if (!routeLocked) return;
    if (event.type === 'keydown' && (event.key === 'Tab' || event.key === 'Shift')) return;
    if (resetBtn.contains(event.target)) return;
    if (event.target.closest('.search-field, #vertical-pref, #find-route-btn')) {
      event.preventDefault();
      event.stopPropagation();
      if (event.target.blur) event.target.blur();
      nudgeReset();
    }
  }, true);
});
findRouteBtn.addEventListener('click', (event) => {
  if (!routeLocked) return;
  event.stopImmediatePropagation();
  nudgeReset();
}, true);
$('lock-dialog-ok').addEventListener('click', () => lockDialog.close());
resetBtn.addEventListener('animationend', () => resetBtn.classList.remove('nudge'));

findRouteBtn.addEventListener('click', handleFindRoute);
replayBtn.addEventListener('click', () => {
  if (currentLegs) playRouteAnimation();
});

// ---------- Full screen map ----------
// Uses the browser's full screen where it exists (desktop, Android) and a full-window layout
// everywhere else (iPhone), so the map can be pinched and dragged without the page moving.
const fsBtn = $('fullscreen-btn');
let mapIsFullscreen = false;

function refreshMapSize() {
  // The frame changed size: rebuild the view so zoom/pan maths use the new shape.
  window.setTimeout(() => {
    if (currentLegs) goToLeg(activeLegIndex);
    else setActiveFloor(activeFloorId);
  }, 80);
}

function syncFsFloorBar() {
  const idx = floorIndex(activeFloorId);
  $('fs-floor-label').textContent = floorLevels[idx].label;
  $('fs-floor-down').disabled = idx <= 0;
  $('fs-floor-up').disabled = idx >= floorLevels.length - 1;
}

function setMapFullscreen(on) {
  if (on === mapIsFullscreen) return;
  mapIsFullscreen = on;
  mapFrame.classList.toggle('is-fullscreen', on);
  document.documentElement.classList.toggle('map-fs', on);
  fsBtn.setAttribute('aria-pressed', String(on));
  fsBtn.setAttribute('aria-label', on ? 'Exit full screen' : 'Full screen map');
  fsBtn.title = on ? 'Exit full screen' : 'Full screen';
  if (on) {
    syncFsFloorBar();
    if (mapFrame.requestFullscreen) mapFrame.requestFullscreen().catch(() => {});
  } else if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => {});
  }
  refreshMapSize();
}

fsBtn.addEventListener('click', () => setMapFullscreen(!mapIsFullscreen));
document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement && mapIsFullscreen) setMapFullscreen(false);
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && mapIsFullscreen) setMapFullscreen(false);
});
$('fs-floor-down').addEventListener('click', () => stepFloor(-1));
$('fs-floor-up').addEventListener('click', () => stepFloor(1));
window.addEventListener('animap:floor-drawn', () => { if (mapIsFullscreen) syncFsFloorBar(); });
resetBtn.addEventListener('click', handleReset);
$('pwd-dialog-ok').addEventListener('click', () => pwdDialog.close());

// ---------- 2D / 3D switch: every flip lands on Upper Ground ----------
window.addEventListener('animap:viewmode', () => {
  if (mapIsFullscreen) setMapFullscreen(false);
  clearActiveRoute();
  setActiveFloor(HOME_FLOOR);
});

// ---------- Legend list (built-in colours plus any the admin added) ----------
const legendList = document.querySelector('ul.legend');
function renderLegend() {
  if (!legendList) return;
  legendList.replaceChildren();
  getLegends().forEach((l) => {
    const li = document.createElement('li');
    const sw = document.createElement('span');
    sw.className = l.custom ? 'swatch' : `swatch cat-${l.id}`;
    if (l.custom) { sw.style.borderColor = l.color; sw.style.background = legendFill(l.color); }
    li.append(sw, document.createTextNode(l.label));
    legendList.appendChild(li);
  });
  const pwd = document.createElement('li');
  pwd.innerHTML = '<span class="swatch swatch-pwd"></span>PWD route (elevator &amp; ramps)';
  legendList.appendChild(pwd);
}
renderLegend();
const legendBox = document.getElementById('legend-box');
if (legendBox) legendBox.open = window.matchMedia('(min-width: 701px)').matches;

// ---------- Admin changes (renames / unavailable rooms / colours) ----------
let wasAdmin = state.admin;
window.addEventListener('animap:data', () => {
  if (state.admin !== wasAdmin) { // logging in or out starts from a clean slate
    wasAdmin = state.admin;
    if (lockDialog.open) lockDialog.close();
    handleReset();
    setActiveFloor(HOME_FLOOR);
  }
  renderLegend();
  allRooms = getAllRooms();
  const fresh = (room) => (room && !room.special ? allRooms.find((r) => r.id === room.id) || room : room);
  fromRoom = fresh(fromRoom);
  toRoom = fresh(toRoom);
  if (currentLegs) {
    currentLegs.origin = fresh(currentLegs.origin);
    currentLegs.destination = fresh(currentLegs.destination);
    goToLeg(activeLegIndex);
  } else {
    setActiveFloor(activeFloorId);
  }
});

initRoomEditor({
  svgRoot,
  getRoom: (id) => {
    for (const floor of Object.values(floorsById)) {
      const room = floor.rooms.find((r) => r.id === id);
      if (room) return { ...room, floorLabel: floor.label };
    }
    return null;
  },
});

setActiveFloor(activeFloorId);
if (window.finishLoading) window.finishLoading(); // the 2D map is ready; the 3D model loads only when asked for