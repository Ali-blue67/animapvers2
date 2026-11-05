// Welcome-page preview: draws a real floor from the campus data and
// animates a real route across it, so the hero always matches the app.
import { buildCampusGraph, getFloorsById, getAllRooms, floorLevels } from './campus-data.js';
import { renderFloor } from './floor-renderer.js';
import { findShortestPath } from './pathfinding.js';

const graph = buildCampusGraph();
const floor = getFloorsById()['level-2'];
const svg = document.getElementById('hero-plan');

renderFloor(svg, floor, graph);

const FROM = 'level-2-lsh124';
const TO = 'level-2-lsh226';
const path = findShortestPath(graph, FROM, TO);

if (path) {
  const line = svg.querySelector('#route-line');
  line.setAttribute('d', path.map((id, i) => `${i ? 'L' : 'M'} ${graph.nodes[id].x} ${graph.nodes[id].y}`).join(' '));
  line.setAttribute('pathLength', '1'); // lets the CSS draw animation work at any size

  const start = graph.nodes[FROM];
  const end = graph.nodes[TO];
  const startMarker = svg.querySelector('#start-marker');
  const endMarker = svg.querySelector('#end-marker');
  startMarker.setAttribute('cx', start.x);
  startMarker.setAttribute('cy', start.y);
  endMarker.setAttribute('cx', end.x);
  endMarker.setAttribute('cy', end.y);

  [FROM, TO].forEach((id) => {
    const room = svg.querySelector(`.room[data-room-id="${id}"]`);
    if (room) room.classList.add('highlight');
  });

  // Crop to the part of the floor where the route happens (keeps the 765:635 preview shape).
  const xs = path.map((id) => graph.nodes[id].x);
  const ys = path.map((id) => graph.nodes[id].y);
  const pad = 150;
  let w = Math.max(...xs) - Math.min(...xs) + pad * 2;
  let h = Math.max(...ys) - Math.min(...ys) + pad * 2;
  const aspect = 765 / 635;
  if (w / h < aspect) w = h * aspect;
  else h = w / aspect;
  const cx = (Math.max(...xs) + Math.min(...xs)) / 2;
  const cy = (Math.max(...ys) + Math.min(...ys)) / 2;
  svg.setAttribute('viewBox', `${cx - w / 2} ${cy - h / 2} ${w} ${h}`);
}

const meta = document.getElementById('hero-meta');
if (meta) {
  meta.textContent = `${floorLevels.length} levels and ${getAllRooms().length} searchable rooms`;
}